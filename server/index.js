require('dotenv').config();
const crypto = require('crypto');

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const Person = require('./models/Person');
const Attendance = require('./models/Attendance');
const Course = require('./models/Course');
const LectureSession = require('./models/LectureSession');
const { startNonRecurringExpiryJob } = require('./lib/sessionExpiry');
const {
  DAY_INDEX,
  toMinutes,
  hasScheduleOverlap,
  isNonRecurringExpired,
} = require('./lib/schedule');

const MAX_COURSE_LECTURERS = 5;
const BOOTSTRAP_ADMIN_EMAIL = 'udayakavindadev@gmail.com';

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}

/**
 * Classifies common Mongo/Mongoose errors so handlers don't return 500 for client mistakes
 * and don't leak driver internals.
 */
function respondError(res, err, fallbackStatus = 500) {
  if (err && err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid identifier' });
  }
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Invalid input' });
  }
  if (err && (err.code === 11000 || err.code === 11001)) {
    return res.status(409).json({ error: 'Duplicate value' });
  }
  return res.status(fallbackStatus).json({ error: isProd ? 'Internal server error' : (err?.message || 'Internal server error') });
}

async function ensureBootstrapAdmin() {
  const email = String(BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;
  let person = await Person.findOne({ email });
  if (!person) {
    person = await Person.create({
      email,
      studentId: `bootstrap:${email}`,
      role: 'admin',
      active: true,
      deleted: false,
    });
    console.log(`Bootstrap admin created: ${email}`);
    return;
  }
  let changed = false;
  if (person.role !== 'admin') {
    person.role = 'admin';
    changed = true;
  }
  if (person.deleted) {
    person.deleted = false;
    changed = true;
  }
  if (!person.active) {
    person.active = true;
    changed = true;
  }
  if (changed) {
    await person.save();
    console.log(`Bootstrap admin updated: ${email}`);
  }
}

/**
 * Geofence edge buffer cap (metres). Runtime configurable in-memory via admin settings.
 * Default is 5m and resets on server restart.
 */
let geofenceAccuracyBufferCapM = 5;

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





function isWithinGeofenceWithAccuracy(lat, lng, accuracy, polygons = []) {
  const inside = isPointInsideAnyPolygon(lat, lng, polygons);
  const accuracyMeters = Number(accuracy);
  const cap = geofenceAccuracyBufferCapM;
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

function localYmd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentOccurrenceKey(now = new Date()) {
  return localYmd(now);
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
  const courseLecturerIds = Array.isArray(course.lecturers) ? course.lecturers.map((id) => String(id)) : [];
  if (!courseLecturerIds.includes(String(person._id))) {
    return { ok: false, status: 403, message: 'Not allowed for this course' };
  }
  return { ok: true, course };
}

async function staffSessionMatch(person, isAdmin) {
  if (isAdmin) return {};
  if (person.role !== 'lecturer') return { course: { $in: [] } };
  const ids = await Course.find({ lecturers: person._id }).distinct('_id');
  return { course: { $in: ids } };
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLecturerIds(rawLecturerIds) {
  if (!Array.isArray(rawLecturerIds)) return [];
  const uniq = [];
  const seen = new Set();
  for (const value of rawLecturerIds) {
    const id = String(value || '').trim();
    if (!mongoose.isValidObjectId(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
    if (uniq.length >= MAX_COURSE_LECTURERS) break;
  }
  return uniq;
}

function normalizeGeofenceBufferCap(rawValue) {
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > 30) return null;
  return rounded;
}





const app = express();

const corsOrigins = (process.env.FRONTEND_URL
  || process.env.APP_BASE_URL
  || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Content Security Policy: production-only enforcement (CRA dev uses `eval` for
// source maps, which CSP would block). Allow-list is built from the actual
// external origins this app loads — see README "Content Security Policy".
const cspExtraConnect = String(process.env.CSP_EXTRA_CONNECT_SRC || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const cspReportOnly = String(process.env.CSP_REPORT_ONLY || '').toLowerCase() === '1'
  || String(process.env.CSP_REPORT_ONLY || '').toLowerCase() === 'true';
const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  imgSrc: [
    "'self'",
    'data:',
    'blob:',
    'https://*.tile.openstreetmap.org',
    'https://server.arcgisonline.com',
  ],
  connectSrc: ["'self'", ...cspExtraConnect],
  frameAncestors: ["'none'"],
  formAction: ["'self'", 'https://accounts.google.com'],
  workerSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
  upgradeInsecureRequests: [],
};

app.use(helmet({
  contentSecurityPolicy: isProd
    ? { useDefaults: false, directives: cspDirectives, reportOnly: cspReportOnly }
    : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));
app.set('trust proxy', 1);

const sessionCookieSecure = isProd;
// Cross-site SPA (different subdomain/port) needs None + Secure in production.
const sessionSameSite = sessionCookieSecure ? 'none' : 'lax';

const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI || 'mongodb://localhost:27017/attendance',
  collectionName: 'sessions',
  ttl: 7 * 24 * 60 * 60,
  touchAfter: 60 * 60,
});
sessionStore.on('error', (err) => console.error('[session-store]', err.message));

// session support required for Passport's req.login() after OAuth
app.use(session({
  name: 'attendance.sid',
  secret: process.env.SESSION_SECRET || 'attendance-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  store: sessionStore,
  cookie: {
    secure: sessionCookieSecure,
    sameSite: sessionSameSite,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

function limiterKeyByUserOrIp(req) {
  const uid = req?.user?._id ? String(req.user._id) : '';
  if (uid) return `user:${uid}`;
  // express-rate-limit helper normalizes IPv6 addresses to avoid bypasses.
  return `ip:${rateLimit.ipKeyGenerator(req.ip)}`;
}

    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem || !sessionItem.active) return res.status(404).json({ error: 'Session not found or inactive' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    if (!isSessionRunningNow(sessionItem)) return res.status(400).json({ error: 'Session is not running now' });
    const state = currentBleState(String(sessionItem._id));
    return res.json({ sessionId: sessionItem._id, attendancePaused: Boolean(sessionItem.attendancePaused), ...state });
  } catch (err) { return respondError(res, err); }
});

/** POST /api/ble/verify-payload
 * Student: submit a BLE-scanned payload to mark attendance.
 * Body: { courseId, payload }
 */
app.post('/api/ble/verify-payload', async (req, res) => {
  const { courseId, payload: submitted } = req.body || {};
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    if (!mongoose.isValidObjectId(String(courseId || ''))) return res.status(400).json({ error: 'Invalid courseId' });
    if (!submitted || typeof submitted !== 'string') return res.status(400).json({ error: 'payload is required' });
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (resolved.session.attendancePaused) {
      return res.status(400).json({ error: 'Attendance is paused for this session. Please wait until your lecturer resumes attendance.' });
    }
    const schedule = checkScheduleWindow(resolved.session);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!isValidBlePayload(String(resolved.session._id), submitted.trim().toUpperCase())) {
      return res.status(400).json({ error: 'Invalid or expired BLE payload. Make sure you are in the lecture room and try again.' });
    }
    const studentPk = auth.person._id;
    const attendanceDate = localYmd();
    const existing = await Attendance.findOne({ student: studentPk, session: resolved.session._id, attendanceDate });
    if (existing) return res.json({ success: true, attendance: existing, duplicate: true });
    try {
      const attendance = await Attendance.create({
        student: studentPk,
        course: resolved.course._id,
        session: resolved.session._id,
        courseCode: resolved.course.code,
        lectureCode: 'ble-verified',
        attendanceDate,
        method: 'ble',
      });
      return res.json({ success: true, attendance });
    } catch (err) {
      if (err && err.code === 11000) {
        const dup = await Attendance.findOne({ student: studentPk, session: resolved.session._id, attendanceDate });
        return res.json({ success: true, attendance: dup, duplicate: true });
      }
      throw err;
    }
  } catch (err) { return respondError(res, err); }
});
// ──────────────────────────────────────────────────────────────────────────



// ─── BLE Payload Rotation ─────────────────────────────────────────────────
const BLE_ROTATION_INTERVAL_MS = 10_000; // 10-second rotation window

function blePayloadForEpoch(sessionId, epoch) {
  const secret = process.env.BLE_SECRET || 'ble-secret-change-in-prod';
  return crypto.createHash('sha256').update(`${sessionId}:${epoch}:${secret}`).digest('hex').slice(0, 8).toUpperCase();
}

function currentBleState(sessionId) {
  const now = Date.now();
  const epoch = Math.floor(now / BLE_ROTATION_INTERVAL_MS);
  return {
    payload: blePayloadForEpoch(sessionId, epoch),
    prevPayload: blePayloadForEpoch(sessionId, epoch - 1),
    secondsRemaining: Math.round((BLE_ROTATION_INTERVAL_MS - (now % BLE_ROTATION_INTERVAL_MS)) / 1000),
    rotationIntervalSeconds: BLE_ROTATION_INTERVAL_MS / 1000,
  };
}

function isValidBlePayload(sessionId, submitted) {
  const epoch = Math.floor(Date.now() / BLE_ROTATION_INTERVAL_MS);
  return submitted === blePayloadForEpoch(sessionId, epoch) || submitted === blePayloadForEpoch(sessionId, epoch - 1);
}
// ─────────────────────────────────────────────────────────────────────────────


// ─── BLE Routes ───────────────────────────────────────────────────────────────

/** GET /api/ble/current-payload/:sessionId
 * Lecturer/Admin: returns the current rotating BLE payload for a session.
 */
app.get('/api/ble/current-payload/:sessionId', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem || !sessionItem.active) return res.status(404).json({ error: 'Session not found or inactive' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    if (!isSessionRunningNow(sessionItem)) return res.status(400).json({ error: 'Session is not running now' });
    const state = currentBleState(String(sessionItem._id));
    return res.json({ sessionId: sessionItem._id, attendancePaused: Boolean(sessionItem.attendancePaused), ...state });
  } catch (err) { return respondError(res, err); }
});

/** POST /api/ble/verify-payload
 * Student: submits a BLE-scanned payload to mark attendance.
 * Body: { courseId, payload }
 */
app.post('/api/ble/verify-payload', async (req, res) => {
  const { courseId, payload: submitted } = req.body || {};
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    if (!mongoose.isValidObjectId(String(courseId || ''))) return res.status(400).json({ error: 'Invalid courseId' });
    if (!submitted || typeof submitted !== 'string') return res.status(400).json({ error: 'payload is required' });
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (resolved.session.attendancePaused) return res.status(400).json({ error: 'Attendance is paused for this session.' });
    const schedule = checkScheduleWindow(resolved.session);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!isValidBlePayload(String(resolved.session._id), submitted.trim().toUpperCase())) {
      return res.status(400).json({ error: 'Invalid or expired BLE payload. Ensure you are in the lecture room and try again.' });
    }
    const studentPk = auth.person._id;
    const attendanceDate = localYmd();
    const existing = await Attendance.findOne({ student: studentPk, session: resolved.session._id, attendanceDate });
    if (existing) return res.json({ success: true, attendance: existing, duplicate: true });
    try {
      const attendance = await Attendance.create({
        student: studentPk, course: resolved.course._id, session: resolved.session._id,
        courseCode: resolved.course.code, lectureCode: 'ble-verified', attendanceDate, method: 'ble',
      });
      return res.json({ success: true, attendance });
    } catch (err2) {
      if (err2 && err2.code === 11000) {
        const dup = await Attendance.findOne({ student: studentPk, session: resolved.session._id, attendanceDate });
        return res.json({ success: true, attendance: dup, duplicate: true });
      }
      throw err2;
    }
  } catch (err) { return respondError(res, err); }
});
// ─────────────────────────────────────────────────────────────────────────────

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
    return respondError(res, err);
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
    return respondError(res, err);
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
    return respondError(res, err);
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
    return respondError(res, err);
  }
});

app.delete('/api/admin/lecturers/:id', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const lec = await Person.findOne({ _id: req.params.id, role: 'lecturer', deleted: false });
    if (!lec) return res.status(404).json({ error: 'Lecturer not found' });

    const affectedCourses = await Course.find({ lecturers: lec._id }).select('_id lecturers');
    let fallbackLecturerId = null;
    const needsFallback = affectedCourses.some((courseDoc) => {
      const remaining = (courseDoc.lecturers || []).filter((id) => String(id) !== String(lec._id));
      return remaining.length === 0;
    });
    if (needsFallback) {
      const fallbackLecturer = await Person.findOne({
        _id: { $ne: lec._id },
        role: 'lecturer',
        deleted: false,
      }).sort({ createdAt: 1 }).select('_id');
      if (!fallbackLecturer) {
        return res.status(400).json({
          error: 'Cannot remove this lecturer because one or more courses would have no assigned lecturer.',
        });
      }
      fallbackLecturerId = fallbackLecturer._id;
    }

    for (const courseDoc of affectedCourses) {
      const nextLecturers = (courseDoc.lecturers || []).filter((id) => String(id) !== String(lec._id));
      courseDoc.lecturers = nextLecturers.length > 0
        ? nextLecturers
        : [fallbackLecturerId];
      await courseDoc.save();
    }

    lec.deleted = true;
    lec.active = false;
    lec.role = 'student';
    await lec.save();
    return res.json({ success: true });
  } catch (err) {
    return respondError(res, err);
  }
});




app.delete('/api/admin/polygon-presets/:id', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    await PolygonPreset.deleteOne({ _id: req.params.id });
    return res.json({ success: true });
  } catch (err) {
    return respondError(res, err);
  }
});

const PORT = process.env.PORT || 5000;
const httpServer = app.listen(PORT, () => {
  console.log(`🚀 Server listening on ${PORT}`);
});

function shutdown(signal) {
  console.log(`[shutdown] received ${signal}`);
  httpServer.close(() => {
    mongoose.connection.close(false).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
