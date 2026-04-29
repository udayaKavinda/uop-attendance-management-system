require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const Person = require('./models/Person');
const Attendance = require('./models/Attendance');
const Course = require('./models/Course');
const LectureSession = require('./models/LectureSession');
const PolygonPreset = require('./models/PolygonPreset');
const lectureCode = require('./lib/lectureCode');
const { startNonRecurringExpiryJob, isNonRecurringExpired } = require('./lib/sessionExpiry');

const DAY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Geofence edge buffer cap (metres). Inside any polygon still passes. Outside passes only
 * if distance to the nearest polygon edge ≤ this (or ≤ reported accuracy when 0 < accuracy ≤ cap).
 */
const GEOFENCE_ACCURACY_BUFFER_CAP_M = 5;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** First segment of email before @; otherwise fallback (e.g. stored studentId). */
function studentDisplayIdFromEmail(email, fallbackStudentId) {
  if (!email || typeof email !== 'string') return String(fallbackStudentId || '').trim();
  const at = email.indexOf('@');
  if (at <= 0) return String(fallbackStudentId || email).trim();
  return email.slice(0, at).trim();
}

function compactTimeForLabel(hhmm) {
  const raw = String(hhmm || '').trim();
  if (!raw) return '';
  const [h, m] = raw.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h)) return raw.slice(0, 5);
  if (!Number.isFinite(m) || m === 0) return String(h);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function timeRangeForColumnLabel(session) {
  const a = compactTimeForLabel(session.startTime);
  const b = compactTimeForLabel(session.endTime);
  if (!a && !b) return '';
  return `${a}-${b}`;
}

/** Column header: "Apr 22 8:00-10:00" (no year) when we have an attendance date; else "MON 8-10". */
function formatAttendanceTableColumnLabel(session, minAttendanceDateYmd) {
  const hourRange = timeRangeForColumnLabel(session);
  if (minAttendanceDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(minAttendanceDateYmd)) {
    const d = new Date(`${minAttendanceDateYmd}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${md} ${hourRange}`.trim();
    }
  }
  return `${session.lectureDay} ${timeRangeForColumnLabel(session)}`.trim();
}

function isPointInsidePolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function checkScheduleWindow(sessionConfig) {
  const now = new Date();
  const day = DAY_INDEX[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(sessionConfig.startTime);
  const end = toMinutes(sessionConfig.endTime);
  if (start === null || end === null) return { ok: false, reason: 'Invalid schedule config' };
  if (day !== sessionConfig.lectureDay) return { ok: false, reason: `Attendance allowed only on ${sessionConfig.lectureDay}` };
  if (currentMinutes < start || currentMinutes > end) {
    return { ok: false, reason: 'Attendance allowed only within the configured lecture time' };
  }
  return { ok: true };
}

function hasScheduleOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isPointInsideAnyPolygon(lat, lng, polygons = []) {
  if (!Array.isArray(polygons) || polygons.length === 0) return false;
  return polygons.some((polygon) => isPointInsidePolygon(lat, lng, polygon));
}

function latLngToXYMeters(lat, lng, originLat, originLng) {
  const R = 6371000;
  const x = (lng - originLng) * (Math.PI / 180) * R * Math.cos((originLat * Math.PI) / 180);
  const y = (lat - originLat) * (Math.PI / 180) * R;
  return { x, y };
}

function pointToSegmentDistanceMeters(pointLat, pointLng, a, b) {
  const originLat = pointLat;
  const originLng = pointLng;
  const p = latLngToXYMeters(pointLat, pointLng, originLat, originLng);
  const p1 = latLngToXYMeters(a.lat, a.lng, originLat, originLng);
  const p2 = latLngToXYMeters(b.lat, b.lng, originLat, originLng);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ddx = p.x - p1.x;
    const ddy = p.y - p1.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  const ddx = p.x - projX;
  const ddy = p.y - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function minDistanceToAnyPolygonEdgeMeters(lat, lng, polygons = []) {
  let min = Number.POSITIVE_INFINITY;
  for (const polygon of polygons || []) {
    if (!Array.isArray(polygon) || polygon.length < 2) continue;
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const d = pointToSegmentDistanceMeters(lat, lng, a, b);
      if (d < min) min = d;
    }
  }
  return min;
}

function isWithinGeofenceWithAccuracy(lat, lng, accuracy, polygons = []) {
  const inside = isPointInsideAnyPolygon(lat, lng, polygons);
  const accuracyMeters = Number(accuracy);
  const cap = GEOFENCE_ACCURACY_BUFFER_CAP_M;
  const edgeBufferMeters = (
    Number.isFinite(accuracyMeters) && accuracyMeters > 0 && accuracyMeters <= cap
  )
    ? accuracyMeters
    : cap;

  if (inside) return true;
  const edgeDistance = minDistanceToAnyPolygonEdgeMeters(lat, lng, polygons);
  return edgeDistance <= edgeBufferMeters;
}

function sessionCodeKey(sessionId) {
  return `session:${sessionId}`;
}

function currentOccurrenceKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function syncSessionCodeMode(sessionItem, now = new Date()) {
  const occurrence = currentOccurrenceKey(now);
  const codeKey = sessionCodeKey(sessionItem._id);
  if (sessionItem.rotationOccurrenceKey !== occurrence) {
    sessionItem.rotationOccurrenceKey = occurrence;
    lectureCode.resetCode(codeKey);
    await sessionItem.save();
  }
  if (sessionItem.rotationEnabled && !sessionItem.rotationPaused) {
    lectureCode.resumeCode(codeKey);
  } else {
    lectureCode.pauseCode(codeKey);
  }
}

function isSessionRunningNow(sessionItem, now = new Date()) {
  if (!sessionItem || !sessionItem.active || sessionItem.deleted) return false;
  const day = DAY_INDEX[now.getDay()];
  if (sessionItem.lectureDay !== day) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(sessionItem.startTime);
  const end = toMinutes(sessionItem.endTime);
  if (start === null || end === null) return false;
  return currentMinutes >= start && currentMinutes <= end;
}

async function resolveActiveSessionForCourse(courseId) {
  const course = await Course.findById(courseId);
  if (!course || !course.active) return { error: 'Invalid course' };
  const now = new Date();
  const day = DAY_INDEX[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const sessions = await LectureSession.find({
    course: course._id,
    active: true,
    deleted: false,
    lectureDay: day,
  });
  const active = sessions.find((s) => {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    return start !== null && end !== null && currentMinutes >= start && currentMinutes <= end;
  });
  if (!active) return { error: 'No active lecture session for this course now' };
  await syncSessionCodeMode(active, now);
  return { course, session: active };
}

/** Staff API authorization: derived from Passport session (Google OAuth), not client headers. */
async function sessionStaffAuth(req) {
  if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }
  const person = await Person.findById(req.user._id);
  if (!person) return { ok: false, status: 401, message: 'User not found' };
  const role = person.role || 'student';
  if (role !== 'admin' && role !== 'lecturer') {
    return { ok: false, status: 403, message: 'Staff access required' };
  }
  if (role === 'lecturer' && person.deleted) {
    return { ok: false, status: 403, message: 'Lecturer access revoked' };
  }
  return { ok: true, person, isAdmin: role === 'admin' };
}

async function sessionAdminAuth(req) {
  const auth = await sessionStaffAuth(req);
  if (!auth.ok) return auth;
  if (!auth.isAdmin) return { ok: false, status: 403, message: 'Admin access required' };
  return { ok: true, person: auth.person, isAdmin: true };
}

/** Student lecture attendance: session only, role must be student. */
async function sessionStudentAuth(req) {
  if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }
  const person = await Person.findById(req.user._id);
  if (!person) return { ok: false, status: 401, message: 'User not found' };
  const role = person.role || 'student';
  if (role !== 'student') {
    return { ok: false, status: 403, message: 'Only student accounts can use lecture attendance' };
  }
  if (person.deleted) {
    return { ok: false, status: 403, message: 'Account inactive' };
  }
  return { ok: true, person };
}

async function assertCourseAccess(person, isAdmin, courseId) {
  const course = await Course.findById(courseId);
  if (!course) return { ok: false, status: 404, message: 'Course not found' };
  if (isAdmin) return { ok: true, course };
  if (person.role !== 'lecturer') return { ok: false, status: 403, message: 'Not allowed for this course' };
  if (String(course.lecturer) !== String(person._id)) {
    return { ok: false, status: 403, message: 'Not allowed for this course' };
  }
  return { ok: true, course };
}

async function staffSessionMatch(person, isAdmin) {
  if (isAdmin) return {};
  if (person.role !== 'lecturer') return { course: { $in: [] } };
  const ids = await Course.find({ lecturer: person._id }).distinct('_id');
  return { course: { $in: ids } };
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePolygonsInput(polygons) {
  if (!Array.isArray(polygons)) return [];
  return polygons
    .map((poly) => (Array.isArray(poly)
      ? poly.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      : []))
    .filter((poly) => poly.length >= 3);
}

const app = express();

const corsOrigins = (process.env.FRONTEND_URL
  || process.env.APP_BASE_URL
  || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());
app.set('trust proxy', 1);

const sessionCookieSecure = process.env.NODE_ENV === 'production';
// Cross-site SPA (different subdomain/port) needs None + Secure in production.
const sessionSameSite = sessionCookieSecure ? 'none' : 'lax';

// session support required for Passport's req.login() after OAuth
app.use(session({
  name: 'attendance.sid',
  secret: process.env.SESSION_SECRET || 'attendance-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: sessionCookieSecure,
    sameSite: sessionSameSite,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const person = await Person.findById(id);
    done(null, person);
  } catch (err) {
    done(err);
  }
});

// passport / Google OAuth configuration
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn('Google OAuth environment variables missing; /auth/google routes will not work');
  app.get('/auth/google', (req, res) => {
    res.status(503).json({
      error: 'Google OAuth not configured',
      message: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env and restart the server.',
    });
  });
} else {
  // Single-domain reverse proxy friendly:
  // APP_BASE_URL should be the public origin (e.g. https://app.domain.com).
  // Fallbacks preserve older two-domain/tunnel setups.
  const appBaseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || process.env.REACT_APP_API_BASE || '';
  const callbackURL = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/auth/google/callback` : '/auth/google/callback';

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const emailRaw = profile.emails && profile.emails[0] && profile.emails[0].value;
      if (!emailRaw) return done(new Error('No email in Google profile'));
      const emailNorm = String(emailRaw).trim().toLowerCase();

      let person = await Person.findOne({ email: emailNorm });
      if (!person) {
        person = await Person.findOne({
          email: { $regex: new RegExp(`^${escapeRegex(emailNorm)}$`, 'i') },
        });
      }
      if (!person) {
        person = await Person.create({
          email: emailNorm,
          studentId: profile.id,
          role: 'student',
        });
      } else {
        let changed = false;
        if (person.email !== emailNorm) {
          const taken = await Person.findOne({ email: emailNorm, _id: { $ne: person._id } });
          if (!taken) {
            person.email = emailNorm;
            changed = true;
          }
        }
        if (String(person.studentId || '').startsWith('dir-') || String(person.studentId || '').startsWith('pending:')) {
          person.studentId = profile.id;
          changed = true;
        } else if (!person.studentId) {
          person.studentId = profile.id;
          changed = true;
        }
        if (!person.role) {
          person.role = 'student';
          changed = true;
        }
        if (changed) await person.save();
      }

      const lecturerRow = await Person.findOne({
        email: emailNorm,
        role: 'lecturer',
        active: true,
        deleted: false,
      });
      let roleSync = false;
      if (lecturerRow) {
        if (person.role !== 'admin' && person.role !== 'lecturer') {
          person.role = 'lecturer';
          roleSync = true;
        }
      } else if (person.role === 'lecturer') {
        person.role = 'student';
        roleSync = true;
      }
      if (roleSync) await person.save();

      return done(null, person);
    } catch (err) {
      return done(err);
    }
  }));

  app.get('/auth/google', passport.authenticate('google', { scope: ['email'] }));
  const frontendUrl = process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: `${frontendUrl}/?error=auth` }),
    (req, res) => {
      const base = String(frontendUrl || '').replace(/\/$/, '');
      res.redirect(`${base}/login/success`);
    }
  );
}

mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance')
  .then(async () => {
    console.log('🗄  MongoDB connected');
    try {
      const r = await LectureSession.updateMany({}, { $unset: { name: 1 } });
      if (r.modifiedCount > 0) {
        console.log(`Removed deprecated session "name" field from ${r.modifiedCount} document(s)`);
      }
    } catch (e) {
      console.warn('LectureSession name cleanup:', e.message);
    }
    try {
      await Course.updateMany({ $or: [{ batch: { $exists: false } }, { batch: null }] }, { $set: { batch: '' } });
      await Course.syncIndexes();
    } catch (e) {
      console.warn('Course batch / index sync:', e.message);
    }
    try {
      const db = mongoose.connection.db;
      const colMeta = await db.listCollections().toArray();
      const colNames = new Set(colMeta.map((c) => c.name));

      if (colNames.has('students') && !colNames.has('people')) {
        await db.collection('students').rename('people');
        console.log('Renamed MongoDB collection students → people');
      }

      await Person.updateMany(
        { lecturerProfile: { $exists: true } },
        { $unset: { lecturerProfile: '' } },
      ).catch(() => {});

      if (colNames.has('lecturers')) {
        const lecDocs = await db.collection('lecturers').find({}).toArray();
        for (const L of lecDocs) {
          const emailN = String(L.email || '').trim().toLowerCase();
          let p = await Person.findOne({ email: emailN });
          if (!p) {
            p = await Person.findOne({
              email: { $regex: new RegExp(`^${escapeRegex(emailN)}$`, 'i') },
            });
          }
          let targetId;
          if (p) {
            p.role = 'lecturer';
            p.name = L.name || p.name || emailN.split('@')[0];
            p.phone = L.phone != null ? String(L.phone) : (p.phone || '');
            p.active = L.active !== false;
            p.deleted = Boolean(L.deleted);
            await p.save();
            targetId = p._id;
          } else {
            const created = await Person.create({
              email: emailN,
              studentId: `dir:${String(L._id)}`,
              role: 'lecturer',
              name: L.name || '',
              phone: L.phone || '',
              active: L.active !== false,
              deleted: Boolean(L.deleted),
            });
            targetId = created._id;
          }
          await Course.updateMany({ lecturer: L._id }, { $set: { lecturer: targetId } });
        }
        await db.collection('lecturers').drop().catch(() => {});
        console.log('Merged lecturers collection into people');
      }

      let legacyOwner = await Person.findOne({ email: 'legacy-placeholder@uop-attendance.local' });
      if (!legacyOwner) {
        legacyOwner = await Person.create({
          name: 'Legacy (unassigned)',
          email: 'legacy-placeholder@uop-attendance.local',
          studentId: 'legacy-placeholder-uop',
          role: 'lecturer',
          phone: '',
          active: true,
          deleted: false,
        });
      }
      const rLec = await Course.updateMany(
        { $or: [{ lecturer: { $exists: false } }, { lecturer: null }] },
        { $set: { lecturer: legacyOwner._id } },
      );
      if (rLec.modifiedCount > 0) {
        console.log(`Assigned legacy course owner to ${rLec.modifiedCount} course(s)`);
      }
      await Person.syncIndexes();
      await PolygonPreset.syncIndexes();
    } catch (e) {
      console.warn('People / course ownership migration:', e.message);
    }
    startNonRecurringExpiryJob();
  })
  .catch((err) => console.error('Mongo connection error', err));

app.post('/api/login', async (req, res) => {
  const { identifier } = req.body;
  try {
    const person = await Person.findOne({
      $or: [{ email: identifier }, { studentId: identifier }],
    });
    if (!person) return res.status(404).json({ message: 'User not found' });
    res.json({ studentId: person._id, email: person.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const person = await Person.findById(req.user._id);
    if (!person) return res.status(401).json({ error: 'User not found' });
    return res.json({
      studentId: person._id,
      email: person.email,
      role: person.role || 'student',
      lecturerId: person.role === 'lecturer' ? person._id : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: err.message });
    return res.json({ success: true });
  });
});

app.get('/api/courses', async (req, res) => {
  try {
    const items = await Course.find({ active: true }).sort({ code: 1, batch: 1 });
    return res.json({
      items: items.map((c) => ({
        _id: c._id,
        code: c.code,
        batch: c.batch,
        name: c.name,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/running', async (req, res) => {
  try {
    const now = new Date();
    const day = DAY_INDEX[now.getDay()];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const sessions = await LectureSession.find({
      active: true,
      deleted: false,
      lectureDay: day,
    }).populate('course', 'code name active batch');

    const runningCourses = new Map();
    sessions.forEach((s) => {
      if (!s.course?.active) return;
      const start = toMinutes(s.startTime);
      const end = toMinutes(s.endTime);
      if (start === null || end === null) return;
      if (currentMinutes < start || currentMinutes > end) return;
      runningCourses.set(String(s.course._id), {
        _id: s.course._id,
        code: s.course.code,
        batch: s.course.batch,
        name: s.course.name,
      });
    });

    return res.json({
      items: Array.from(runningCourses.values()).sort((a, b) => {
        const c = String(a.code).localeCompare(String(b.code));
        if (c !== 0) return c;
        return String(a.batch || '').localeCompare(String(b.batch || ''));
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/courses', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const filter = auth.isAdmin ? {} : { lecturer: auth.person._id };
    const items = await Course.find(filter).populate('lecturer', 'name email phone').sort({ code: 1, batch: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/courses', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const code = lectureCode.normalizeCourseCode(req.body.code);
    const name = String(req.body.name || '').trim();
    const batch = String(req.body.batch ?? '').trim();
    const lecturerIdBody = req.body.lecturerId;
    if (!code || !name) return res.status(400).json({ error: 'name and code are required' });
    if (!batch) return res.status(400).json({ error: 'batch is required' });
    let lecturerToAssign;
    if (auth.isAdmin) {
      if (!mongoose.isValidObjectId(String(lecturerIdBody || ''))) {
        return res.status(400).json({ error: 'lecturerId is required for admins' });
      }
      const lec = await Person.findOne({ _id: lecturerIdBody, role: 'lecturer', deleted: false });
      if (!lec) return res.status(400).json({ error: 'Invalid lecturer' });
      lecturerToAssign = lec._id;
    } else {
      lecturerToAssign = auth.person._id;
    }
    const existing = await Course.findOne({ code, batch });
    if (existing) return res.status(400).json({ error: 'A course with this code and batch already exists' });
    const course = await Course.create({ name, code, batch, active: true, lecturer: lecturerToAssign });
    await course.populate('lecturer', 'name email phone');
    return res.json({ success: true, course });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'A course with this code and batch already exists' });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/courses/:courseId', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, req.params.courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const course = access.course;
    const sessionIds = await LectureSession.find({ course: course._id }).distinct('_id');
    await Attendance.deleteMany({ course: course._id });
    await LectureSession.deleteMany({ course: course._id });
    await Course.deleteOne({ _id: course._id });
    sessionIds.forEach((id) => lectureCode.removeKey(sessionCodeKey(id)));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/courses/:courseId/disable', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, req.params.courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const course = access.course;
    course.active = false;
    await course.save();
    await LectureSession.updateMany({ course: course._id }, { $set: { active: false } });
    const sessionIds = await LectureSession.find({ course: course._id }).distinct('_id');
    sessionIds.forEach((id) => lectureCode.removeKey(sessionCodeKey(id)));
    return res.json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/courses/:courseId/enable', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, req.params.courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const course = access.course;
    course.active = true;
    await course.save();
    return res.json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/courses/:courseId/assign-lecturer', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const lecturerIdBody = req.body.lecturerId;
    if (!mongoose.isValidObjectId(String(lecturerIdBody || ''))) {
      return res.status(400).json({ error: 'lecturerId is required' });
    }
    const lec = await Person.findOne({ _id: lecturerIdBody, role: 'lecturer', deleted: false });
    if (!lec) return res.status(400).json({ error: 'Invalid lecturer' });
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    course.lecturer = lec._id;
    await course.save();
    await course.populate('lecturer', 'name email phone');
    return res.json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/courses/:courseId/sessions', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, req.params.courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const items = await LectureSession.find({ course: req.params.courseId, deleted: false }).sort({ lectureDay: 1, startTime: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/courses/:courseId/sessions', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, req.params.courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const course = access.course;
    if (!course.active) return res.status(404).json({ error: 'Course not found' });
    const {
      lectureDay, startTime, endTime, recurring, rotationEnabled, polygons,
    } = req.body || {};
    const allowedDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    if (!allowedDays.includes(String(lectureDay || '').toUpperCase())) {
      return res.status(400).json({ error: 'lectureDay must be MON..SUN' });
    }
    const s = toMinutes(startTime);
    const e = toMinutes(endTime);
    if (s === null || e === null || s >= e) {
      return res.status(400).json({ error: 'Invalid startTime/endTime (HH:mm)' });
    }
    const normalizedPolygons = normalizePolygonsInput(polygons);
    const sameDaySessions = await LectureSession.find({
      course: course._id,
      lectureDay: String(lectureDay).toUpperCase(),
      deleted: false,
    });
    const overlap = sameDaySessions.find((item) => {
      const itemStart = toMinutes(item.startTime);
      const itemEnd = toMinutes(item.endTime);
      return hasScheduleOverlap(s, e, itemStart, itemEnd);
    });
    if (overlap) {
      return res.status(400).json({ error: 'This session overlaps with an existing session for the same course' });
    }
    const created = await LectureSession.create({
      course: course._id,
      lectureDay: String(lectureDay).toUpperCase(),
      startTime,
      endTime,
      recurring: Boolean(recurring),
      rotationEnabled: Boolean(rotationEnabled),
      rotationPaused: !Boolean(rotationEnabled),
      rotationOccurrenceKey: '',
      polygons: normalizedPolygons,
      active: true,
    });
    return res.json({ success: true, session: created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/sessions/:sessionId', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    sessionItem.active = false;
    sessionItem.deleted = true;
    await sessionItem.save();
    lectureCode.removeKey(sessionCodeKey(sessionItem._id));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/sessions/:sessionId/activate', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false }).populate('course');
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    if (!sessionItem.course?.active) return res.status(400).json({ error: 'Course is disabled' });
    sessionItem.active = true;
    await sessionItem.save();
    if (sessionItem.rotationEnabled) {
      if (sessionItem.rotationPaused) lectureCode.pauseCode(sessionCodeKey(sessionItem._id));
      else lectureCode.resumeCode(sessionCodeKey(sessionItem._id));
    }
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/sessions/:sessionId/deactivate', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    sessionItem.active = false;
    await sessionItem.save();
    lectureCode.removeKey(sessionCodeKey(sessionItem._id));
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sessions', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const scope = await staffSessionMatch(auth.person, auth.isAdmin);
    const items = await LectureSession.find({ deleted: false, ...scope })
      .populate('course', 'code name active batch lecturer')
      .sort({ updatedAt: -1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sessions/current-codes', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const scope = await staffSessionMatch(auth.person, auth.isAdmin);
    const now = new Date();
    const sessions = await LectureSession.find({ active: true, deleted: false, ...scope })
      .populate('course', 'code active batch');
    const running = sessions.filter((s) => s.course?.active && isSessionRunningNow(s, now));
    const items = [];
    for (const s of running) {
      const codeKey = sessionCodeKey(s._id);
      await syncSessionCodeMode(s, now);

      items.push({
        sessionId: s._id,
        courseCode: s.course.code,
        rotationEnabled: Boolean(s.rotationEnabled),
        rotationPaused: Boolean(s.rotationPaused),
        ...lectureCode.getCurrent(codeKey),
      });
    }
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/sessions/:sessionId/rotation/start', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    sessionItem.rotationEnabled = true;
    sessionItem.rotationPaused = false;
    await sessionItem.save();
    lectureCode.resumeCode(sessionCodeKey(sessionItem._id));
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/sessions/:sessionId/rotation/stop', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    sessionItem.rotationEnabled = true;
    sessionItem.rotationPaused = true;
    await sessionItem.save();
    lectureCode.pauseCode(sessionCodeKey(sessionItem._id));
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sessions/:sessionId/current-code', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (sessionItem) {
      const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
      if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    }
    if (sessionItem && isNonRecurringExpired(sessionItem)) {
      sessionItem.active = false;
      await sessionItem.save();
      lectureCode.removeKey(sessionCodeKey(sessionItem._id));
    }
    if (!sessionItem || !sessionItem.active) return res.status(404).json({ error: 'Session not found' });
    return res.json({ sessionId: sessionItem._id, ...lectureCode.getCurrent(sessionCodeKey(sessionItem._id)) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/lecture-code', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ error: 'courseId query parameter is required' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    return res.json({
      courseId: resolved.course._id,
      sessionId: resolved.session._id,
      ...lectureCode.getCurrent(sessionCodeKey(resolved.session._id)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/attendance-status', async (req, res) => {
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const courseId = String(req.query.courseId || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId query parameter is required' });

    const studentPk = auth.person._id;
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) {
      return res.json({
        studentId: studentPk,
        courseId,
        sessionId: null,
        attended: false,
        attendanceId: null,
        attendedAt: null,
      });
    }

    const attendanceDate = new Date().toISOString().slice(0, 10);
    const attendance = await Attendance.findOne({
      student: studentPk,
      course: courseId,
      session: resolved.session._id,
      attendanceDate,
    }).sort({ timestamp: -1 });

    return res.json({
      studentId: studentPk,
      courseId,
      sessionId: resolved.session._id,
      attended: Boolean(attendance),
      attendanceId: attendance?._id || null,
      attendedAt: attendance?.timestamp || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify-lecture', async (req, res) => {
  const {
    lectureCode: submitted, courseId, lat, lng, accuracy,
  } = req.body;
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (!lectureCode.hasValidLocation(lat, lng)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }
    if (!lectureCode.isValidCode(sessionCodeKey(resolved.session._id), submitted)) {
      return res.status(400).json({ error: 'Invalid or expired lecture code' });
    }
    const schedule = checkScheduleWindow(resolved.session);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!isWithinGeofenceWithAccuracy(Number(lat), Number(lng), Number(accuracy), resolved.session.polygons || [])) {
      return res.status(400).json({ error: 'You are outside the allowed attendance area' });
    }
    return res.json({ success: true, sessionId: resolved.session._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** PIN + schedule only (student). Starts multi-sample GPS flow on the client when PIN is valid. */
app.post('/api/verify-lecture-pin', async (req, res) => {
  const { lectureCode: submitted, courseId } = req.body;
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (!lectureCode.isValidCode(sessionCodeKey(resolved.session._id), submitted)) {
      return res.status(400).json({ error: 'Invalid or expired lecture code' });
    }
    const schedule = checkScheduleWindow(resolved.session);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    return res.json({
      success: true,
      sessionId: resolved.session._id,
      courseId: resolved.course._id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/record-attendance', async (req, res) => {
  const {
    lectureCode: submitted, courseId, method, lat, lng, accuracy,
  } = req.body;
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const studentPk = auth.person._id;
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (!lectureCode.hasValidLocation(lat, lng)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }
    if (!lectureCode.isValidCode(sessionCodeKey(resolved.session._id), submitted)) {
      return res.status(400).json({ error: 'Invalid or expired lecture code' });
    }
    const schedule = checkScheduleWindow(resolved.session);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!isWithinGeofenceWithAccuracy(Number(lat), Number(lng), Number(accuracy), resolved.session.polygons || [])) {
      return res.status(400).json({ error: 'You are outside the allowed attendance area' });
    }

    const normalizedCode = String(submitted).replace(/\s/g, '');
    const attendanceDate = new Date().toISOString().slice(0, 10);
    const existing = await Attendance.findOne({
      student: studentPk,
      session: resolved.session._id,
      attendanceDate,
    });
    if (existing) {
      return res.json({ success: true, attendance: existing, duplicate: true });
    }

    const attendance = new Attendance({
      student: studentPk,
      course: resolved.course._id,
      session: resolved.session._id,
      courseCode: resolved.course.code,
      lectureCode: normalizedCode,
      attendanceDate,
      method,
      location: { lat: Number(lat), lng: Number(lng), accuracy: Number(accuracy) },
    });
    await attendance.save();
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/courses/:courseId/attendance-matrix', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, req.params.courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const course = access.course;

    const sessionIds = await Attendance.distinct('session', { course: course._id });
    const attendanceDocs = await Attendance.find({ course: course._id, session: { $in: sessionIds } })
      .populate('student', 'studentId email');
    const sessionMinDate = new Map();
    attendanceDocs.forEach((doc) => {
      const sessKey = String(doc.session);
      const ymd = doc.attendanceDate;
      if (!ymd) return;
      const prev = sessionMinDate.get(sessKey);
      if (!prev || ymd < prev) sessionMinDate.set(sessKey, ymd);
    });
    const sessions = await LectureSession.find({ _id: { $in: sessionIds } });
    sessions.sort((a, b) => {
      const da = sessionMinDate.get(String(a._id));
      const db = sessionMinDate.get(String(b._id));
      if (da && db && da !== db) return da.localeCompare(db);
      if (da && !db) return -1;
      if (!da && db) return 1;
      const dOrder = (day) => DAY_INDEX.indexOf(String(day || '').toUpperCase());
      const diffDay = dOrder(a.lectureDay) - dOrder(b.lectureDay);
      if (diffDay !== 0) return diffDay;
      const taN = toMinutes(a.startTime);
      const tbN = toMinutes(b.startTime);
      if (taN !== tbN) return (taN ?? -1) - (tbN ?? -1);
      return String(a._id).localeCompare(String(b._id));
    });
    const rowsMap = new Map();
    attendanceDocs.forEach((doc) => {
      const sid = String(doc.student?._id || '');
      if (!sid) return;
      if (!rowsMap.has(sid)) {
        rowsMap.set(sid, {
          studentId: studentDisplayIdFromEmail(doc.student?.email, doc.student?.studentId),
          email: doc.student.email,
          attendance: {},
        });
      }
      rowsMap.get(sid).attendance[String(doc.session)] = true;
    });
    return res.json({
      course: { _id: course._id, code: course.code, batch: course.batch, name: course.name },
      sessions: sessions.map((s) => ({
        _id: s._id,
        label: formatAttendanceTableColumnLabel(s, sessionMinDate.get(String(s._id))),
      })),
      rows: Array.from(rowsMap.values()),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/lecturers', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const q = String(req.query.q || '').trim();
    const filter = { role: 'lecturer', deleted: false };
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { email: re }, { phone: re }];
    }
    const items = await Person.find(filter).sort({ name: 1, email: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/lecturers', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone ?? '').trim();
    if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
    let p = await Person.findOne({ email });
    if (!p) {
      p = await Person.create({
        email,
        studentId: `dir:${new mongoose.Types.ObjectId().toString()}`,
        role: 'lecturer',
        name,
        phone,
        active: true,
        deleted: false,
      });
    } else {
      if (p.role === 'admin') return res.status(400).json({ error: 'Cannot convert this account to lecturer' });
      p.role = 'lecturer';
      p.name = name;
      p.phone = phone;
      p.active = true;
      p.deleted = false;
      await p.save();
    }
    return res.json({ success: true, lecturer: p });
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ error: 'Email already registered' });
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/lecturers/:id', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const lec = await Person.findOne({ _id: req.params.id, role: 'lecturer', deleted: false });
    if (!lec) return res.status(404).json({ error: 'Lecturer not found' });
    const { name, email, phone, active } = req.body || {};
    if (name !== undefined) lec.name = String(name).trim();
    if (phone !== undefined) lec.phone = String(phone).trim();
    if (active !== undefined) lec.active = Boolean(active);
    if (email !== undefined) {
      const next = String(email).trim().toLowerCase();
      if (!next) return res.status(400).json({ error: 'email is required' });
      lec.email = next;
    }
    await lec.save();
    return res.json({ success: true, lecturer: lec });
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ error: 'Email already registered' });
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/lecturers/:id', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const lec = await Person.findOne({ _id: req.params.id, role: 'lecturer', deleted: false });
    if (!lec) return res.status(404).json({ error: 'Lecturer not found' });
    lec.deleted = true;
    lec.active = false;
    lec.role = 'student';
    await lec.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/polygon-presets', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const items = await PolygonPreset.find({}).sort({ name: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/polygon-presets', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const name = String(req.body.name || '').trim();
    const polygons = normalizePolygonsInput(req.body.polygons);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const preset = await PolygonPreset.create({ name, polygons });
    return res.json({ success: true, preset });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/polygon-presets/:id', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const preset = await PolygonPreset.findById(req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    const { name, polygons } = req.body || {};
    if (name !== undefined) preset.name = String(name).trim();
    if (polygons !== undefined) preset.polygons = normalizePolygonsInput(polygons);
    await preset.save();
    return res.json({ success: true, preset });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/polygon-presets/:id', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    await PolygonPreset.deleteOne({ _id: req.params.id });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on ${PORT}`);
});
