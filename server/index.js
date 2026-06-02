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
const bluetoothCode = require('./lib/bluetoothCode');
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

if (process.env.NODE_ENV === 'test') {
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-user'];
    if (raw) {
      try {
        const u = JSON.parse(raw);
        req.user = u;
        req.isAuthenticated = () => true;
      } catch (_) {}
    }
    next();
  });
}

function limiterKeyByUserOrIp(req) {
  const uid = req?.user?._id ? String(req.user._id) : '';
  if (uid) return `user:${uid}`;
  // express-rate-limit helper normalizes IPv6 addresses to avoid bypasses.
  return `ip:${rateLimit.ipKeyGenerator(req.ip)}`;
}

const studentRecordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: limiterKeyByUserOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please slow down.' },
});
const oauthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts.' },
});

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
        const synthStudentId = String(person.studentId || '');
        if (synthStudentId.startsWith('dir:') || synthStudentId.startsWith('dir-') || synthStudentId.startsWith('pending:')) {
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

  app.get('/auth/google', oauthLimiter, passport.authenticate('google', { scope: ['email'] }));
  const frontendUrl = process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  app.get(
    '/auth/google/callback',
    oauthLimiter,
    passport.authenticate('google', { failureRedirect: `${frontendUrl}/?error=auth` }),
    (req, res) => {
      const base = String(frontendUrl || '').replace(/\/$/, '');
      res.redirect(`${base}/login/success`);
    }
  );
}

if (require.main === module) {
  mongoose
    .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance')
    .then(async () => {
      console.log('🗄  MongoDB connected');
      try {
        await LectureSession.syncIndexes();
        await Attendance.syncIndexes();
        await Person.syncIndexes();
        await Course.syncIndexes();
      } catch (e) {
        console.warn('Index sync:', e.message);
      }
      try {
        await ensureBootstrapAdmin();
      } catch (e) {
        console.warn('Bootstrap admin:', e.message);
      }
      startNonRecurringExpiryJob();
    })
    .catch((err) => console.error('Mongo connection error', err));
}

app.get('/api/healthz', async (req, res) => {
  const mongoState = mongoose.connection?.readyState === 1 ? 'ok' : 'down';
  res.status(mongoState === 'ok' ? 200 : 503).json({ status: mongoState });
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
    return respondError(res, err);
  }
});

app.post('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) return respondError(res, err);
    return res.json({ success: true });
  });
});

app.get('/api/courses', async (req, res) => {
  try {
    if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
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
    return respondError(res, err);
  }
});

app.get('/api/courses/running', async (req, res) => {
  try {
    if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
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
    return respondError(res, err);
  }
});

app.get('/api/admin/courses', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const filter = auth.isAdmin ? {} : { lecturers: auth.person._id };
    const items = await Course.find(filter).populate('lecturers', 'name email phone').sort({ code: 1, batch: 1 });
    return res.json({ items });
  } catch (err) {
    return respondError(res, err);
  }
});

app.post('/api/admin/courses', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const name = String(req.body.name || '').trim();
    const batch = String(req.body.batch ?? '').trim();
    const lecturerIdsBody = normalizeLecturerIds(req.body.lecturerIds);
    if (!code || !name) return res.status(400).json({ error: 'name and code are required' });
    if (!batch) return res.status(400).json({ error: 'batch is required' });
    let lecturerIdsToAssign;
    if (auth.isAdmin) {
      if (lecturerIdsBody.length === 0 || lecturerIdsBody.length > MAX_COURSE_LECTURERS) {
        return res.status(400).json({ error: `lecturerIds must include 1 to ${MAX_COURSE_LECTURERS} lecturers` });
      }
      const validLecturers = await Person.find({
        _id: { $in: lecturerIdsBody },
        role: 'lecturer',
        deleted: false,
      }).select('_id');
      if (validLecturers.length !== lecturerIdsBody.length) {
        return res.status(400).json({ error: 'Invalid lecturerIds' });
      }
      lecturerIdsToAssign = lecturerIdsBody;
    } else {
      lecturerIdsToAssign = [String(auth.person._id)];
    }
    const existing = await Course.findOne({ code, batch });
    if (existing) return res.status(400).json({ error: 'A course with this code and batch already exists' });
    const course = await Course.create({
      name,
      code,
      batch,
      active: true,
      lecturers: lecturerIdsToAssign,
    });
    await course.populate('lecturers', 'name email phone');
    return res.json({ success: true, course });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'A course with this code and batch already exists' });
    }
    return respondError(res, err);
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
    return res.json({ success: true });
  } catch (err) {
    return respondError(res, err);
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
    return res.json({ success: true, course });
  } catch (err) {
    return respondError(res, err);
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
    return respondError(res, err);
  }
});

app.patch('/api/admin/courses/:courseId/assign-lecturer', async (req, res) => {
  try {
    const auth = await sessionAdminAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const lecturerIds = normalizeLecturerIds(req.body.lecturerIds);
    if (lecturerIds.length === 0 || lecturerIds.length > MAX_COURSE_LECTURERS) {
      return res.status(400).json({ error: `lecturerIds must include 1 to ${MAX_COURSE_LECTURERS} lecturers` });
    }
    const validLecturers = await Person.find({
      _id: { $in: lecturerIds },
      role: 'lecturer',
      deleted: false,
    }).select('_id');
    if (validLecturers.length !== lecturerIds.length) return res.status(400).json({ error: 'Invalid lecturerIds' });
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    course.lecturers = lecturerIds;
    await course.save();
    await course.populate('lecturers', 'name email phone');
    return res.json({ success: true, course });
  } catch (err) {
    return respondError(res, err);
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
    return respondError(res, err);
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
      lectureDay, startTime, endTime, recurring, rotationEnabled,
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
      active: true,
    });
    return res.json({ success: true, session: created });
  } catch (err) {
    return respondError(res, err);
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
    sessionItem.deleted = true;
    sessionItem.active = false;
    await sessionItem.save();
    return res.json({ success: true });
  } catch (err) { return respondError(res, err); }
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
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return respondError(res, err);
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
    sessionItem.attendancePaused = false;
    await sessionItem.save();
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return respondError(res, err);
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
    return respondError(res, err);
  }
});




// ── Bluetooth admin routes ────────────────────────────────────────────────────

app.patch('/api/admin/sessions/:sessionId/bluetooth/start', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    if (!sessionItem.bluetoothDeviceName) {
      sessionItem.bluetoothDeviceName = bluetoothCode.generateDeviceName();
    }
    sessionItem.bluetoothEnabled = true;
    await sessionItem.save();
    bluetoothCode.getToken(String(sessionItem._id)); // seed so auto-rotation starts immediately
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return respondError(res, err);
  }
});

app.patch('/api/admin/sessions/:sessionId/bluetooth/stop', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    sessionItem.bluetoothEnabled = false;
    await sessionItem.save();
    bluetoothCode.removeToken(String(sessionItem._id));
    return res.json({ success: true, session: sessionItem });
  } catch (err) {
    return respondError(res, err);
  }
});

// For the lecturer's native broadcaster app: returns the device name + current rotating token.
app.get('/api/admin/sessions/:sessionId/bluetooth-broadcast', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    if (!sessionItem.bluetoothEnabled) return res.status(400).json({ error: 'Bluetooth not enabled for this session' });
    const { token, rotatesIn } = bluetoothCode.getToken(String(sessionItem._id));
    return res.json({
      sessionId: sessionItem._id,
      deviceName: sessionItem.bluetoothDeviceName,
      token,
      rotatesIn,
      rotationMs: bluetoothCode.ROTATION_MS,
      attendancePaused: Boolean(sessionItem.attendancePaused),
    });
  } catch (err) {
    return respondError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.patch('/api/admin/sessions/:sessionId/attendance-paused', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const paused = Boolean(req.body?.paused);
    sessionItem.attendancePaused = paused;
    await sessionItem.save();
    return res.json({ success: true, session: sessionItem, attendancePaused: paused });
  } catch (err) {
    return respondError(res, err);
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
      return res.json({ studentId: studentPk, courseId, sessionId: null, attended: false, attendanceId: null, attendedAt: null });
    }
    const attendanceDate = localYmd();
    const attendance = await Attendance.findOne({ student: studentPk, session: resolved.session._id, attendanceDate });
    return res.json({
      studentId: studentPk, courseId, sessionId: resolved.session._id,
      attended: Boolean(attendance), attendanceId: attendance?._id || null, attendedAt: attendance?.timestamp || null,
    });
  } catch (err) { return respondError(res, err); }
});
// ──────────────────────────────────────────────────────────────────────────





// ─── BLE Routes ───────────────────────────────────────────────────────────────

/** GET /api/ble/current-payload/:sessionId
 * Lecturer/Admin: returns the current rotating BLE payload for a session.
 */


// ─────────────────────────────────────────────────────────────────────────────

// ── Bluetooth student routes ──────────────────────────────────────────────────

// Returns the BLE device name for the active session — student needs this to
// know which device to scan for.
app.get('/api/bluetooth-target', async (req, res) => {
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const courseId = String(req.query.courseId || '').trim();
    if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ error: 'Invalid courseId' });
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (!resolved.session.bluetoothEnabled) {
      return res.status(400).json({ error: 'Bluetooth attendance is not enabled for this session' });
    }
    return res.json({
      deviceName: resolved.session.bluetoothDeviceName,
    });
  } catch (err) {
    return respondError(res, err);
  }
});

// Student submits the BT token scanned from the advertisement payload.
app.post('/api/bluetooth-attendance', studentRecordLimiter, async (req, res) => {
  const { courseId, token } = req.body || {};
  try {
    const auth = await sessionStudentAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    if (!mongoose.isValidObjectId(String(courseId || ''))) {
      return res.status(400).json({ error: 'Invalid courseId' });
    }
    if (!token || typeof token !== 'string' || !/^[0-9a-f]{16}$/i.test(token.trim())) {
      return res.status(400).json({ error: 'Invalid Bluetooth token' });
    }
    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    if (!resolved.session.bluetoothEnabled) {
      return res.status(400).json({ error: 'Bluetooth attendance is not enabled for this session' });
    }
    if (resolved.session.attendancePaused) {
      return res.status(400).json({ error: 'Attendance is paused. Please wait until your lecturer resumes.' });
    }
    const schedule = checkScheduleWindow(resolved.session);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!bluetoothCode.verifyToken(String(resolved.session._id), token.trim().toLowerCase())) {
      return res.status(400).json({ error: 'Invalid or expired Bluetooth token. Move closer and try again.' });
    }
    const studentPk = auth.person._id;
    const attendanceDate = localYmd();
    const existing = await Attendance.findOne({
      student: studentPk,
      session: resolved.session._id,
      attendanceDate,
    });
    if (existing) return res.json({ success: true, attendance: existing, duplicate: true });
    try {
      const attendance = await Attendance.create({
        student: studentPk,
        course: resolved.course._id,
        session: resolved.session._id,
        courseCode: resolved.course.code,
        lectureCode: token.trim().toLowerCase(),
        attendanceDate,
        method: 'bluetooth',
      });
      return res.json({ success: true, attendance });
    } catch (err) {
      if (err && err.code === 11000) {
        const dup = await Attendance.findOne({
          student: studentPk,
          session: resolved.session._id,
          attendanceDate,
        });
        return res.json({ success: true, attendance: dup, duplicate: true });
      }
      throw err;
    }
  } catch (err) {
    return respondError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────


// Lecturer: get attendance records for a specific session
app.get('/api/admin/sessions/:sessionId/attendance', async (req, res) => {
  try {
    const auth = await sessionStaffAuth(req);
    if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const access = await assertCourseAccess(auth.person, auth.isAdmin, sessionItem.course);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    const records = await Attendance.find({ session: sessionItem._id })
      .populate('student', 'studentId email name').sort({ timestamp: -1 });
    return res.json({ records });
  } catch (err) { return respondError(res, err); }
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


if (require.main === module) {
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
}

module.exports = app;
