require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const Student = require('./models/Student');
const Attendance = require('./models/Attendance');
const Course = require('./models/Course');
const LectureSession = require('./models/LectureSession');
const lectureCode = require('./lib/lectureCode');

const DAY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
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

function isNonRecurringExpired(sessionItem, now = new Date()) {
  if (!sessionItem || sessionItem.recurring) return false;
  const day = DAY_INDEX[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const end = toMinutes(sessionItem.endTime);
  if (end === null) return false;
  return day === sessionItem.lectureDay && currentMinutes > end;
}

async function deactivateExpiredNonRecurringSessions(filter = {}) {
  const candidates = await LectureSession.find({ ...filter, active: true, recurring: false, deleted: false });
  const expiredIds = candidates.filter((s) => isNonRecurringExpired(s)).map((s) => s._id);
  if (expiredIds.length === 0) return;
  await LectureSession.updateMany({ _id: { $in: expiredIds } }, { $set: { active: false } });
  expiredIds.forEach((id) => lectureCode.removeKey(sessionCodeKey(id)));
}

async function resolveActiveSessionForCourse(courseId) {
  const course = await Course.findById(courseId);
  if (!course || !course.active) return { error: 'Invalid course' };
  await deactivateExpiredNonRecurringSessions({ course: course._id });
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

async function requireAdminByStudentId(studentId) {
  if (!studentId) return { ok: false, message: 'Missing X-Student-Id header' };
  const student = await Student.findById(studentId);
  if (!student) return { ok: false, message: 'User not found' };
  if (student.role !== 'admin') return { ok: false, message: 'Admin access required' };
  return { ok: true, student };
}

const app = express();
app.use(cors());
app.use(express.json());

// session support required for Passport's req.login() after OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'attendance-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const student = await Student.findById(id);
    done(null, student);
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
      const email = profile.emails && profile.emails[0] && profile.emails[0].value;
      if (!email) return done(new Error('No email in Google profile'));
      let student = await Student.findOne({ email });
      if (!student) {
        // First sign-in: always create a DB row in Students.
        student = await Student.create({
          email,
          studentId: profile.id,
          role: 'student',
        });
      } else {
        // Self-heal older records that may miss required fields.
        let changed = false;
        if (!student.studentId) {
          student.studentId = profile.id;
          changed = true;
        }
        if (!student.role) {
          student.role = 'student';
          changed = true;
        }
        if (changed) await student.save();
      }
      return done(null, student);
    } catch (err) {
      return done(err);
    }
  }));

  app.get('/auth/google', passport.authenticate('google', { scope: ['email'] }));
  const frontendUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: `${frontendUrl}/?error=auth` }),
    (req, res) => {
      const student = req.user;
      res.redirect(`${frontendUrl}/login/success?studentId=${student._id}`);
    }
  );
}

mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance')
  .then(() => console.log('🗄  MongoDB connected'))
  .catch((err) => console.error('Mongo connection error', err));

app.post('/api/login', async (req, res) => {
  const { identifier } = req.body;
  try {
    const student = await Student.findOne({
      $or: [{ email: identifier }, { studentId: identifier }],
    });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json({ studentId: student._id, email: student.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const studentId = String(req.query.studentId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'studentId query parameter is required' });
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: 'User not found' });
    return res.json({
      studentId: student._id,
      email: student.email,
      role: student.role || 'student',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses', async (req, res) => {
  try {
    const items = await Course.find({ active: true }).sort({ code: 1 });
    return res.json({
      items: items.map((c) => ({
        _id: c._id,
        code: c.code,
        name: c.name,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/running', async (req, res) => {
  try {
    await deactivateExpiredNonRecurringSessions();
    const now = new Date();
    const day = DAY_INDEX[now.getDay()];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const sessions = await LectureSession.find({
      active: true,
      deleted: false,
      lectureDay: day,
    }).populate('course', 'code name active');

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
        name: s.course.name,
      });
    });

    return res.json({ items: Array.from(runningCourses.values()).sort((a, b) => String(a.code).localeCompare(String(b.code))) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/courses', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const items = await Course.find({}).sort({ code: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/courses', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const code = lectureCode.normalizeCourseCode(req.body.code);
    const name = String(req.body.name || '').trim();
    if (!code || !name) return res.status(400).json({ error: 'name and code are required' });
    const existing = await Course.findOne({ code });
    if (existing) return res.status(400).json({ error: 'Course code already exists' });
    const course = await Course.create({ name, code, active: true });
    return res.json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/courses/:courseId', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    course.active = true;
    await course.save();
    return res.json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/courses/:courseId/sessions', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    await deactivateExpiredNonRecurringSessions({ course: req.params.courseId });
    const items = await LectureSession.find({ course: req.params.courseId, deleted: false }).sort({ lectureDay: 1, startTime: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/courses/:courseId/sessions', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const course = await Course.findById(req.params.courseId);
    if (!course || !course.active) return res.status(404).json({ error: 'Course not found' });
    const {
      name, lectureDay, startTime, endTime, recurring, rotationEnabled, polygons,
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
    const normalizedPolygons = Array.isArray(polygons)
      ? polygons
        .map((poly) => (Array.isArray(poly)
          ? poly.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          : []))
        .filter((poly) => poly.length >= 3)
      : [];
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
      name: String(name || '').trim(),
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false }).populate('course');
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    await deactivateExpiredNonRecurringSessions();
    const items = await LectureSession.find({ deleted: false })
      .populate('course', 'code name active')
      .sort({ updatedAt: -1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sessions/current-codes', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    await deactivateExpiredNonRecurringSessions();
    const now = new Date();
    const sessions = await LectureSession.find({ active: true, deleted: false })
      .populate('course', 'code active');
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
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
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const sessionItem = await LectureSession.findOne({ _id: req.params.sessionId, deleted: false });
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
    const { courseId } = req.query;
    if (!courseId) return res.status(400).json({ error: 'courseId query parameter is required' });
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
    const studentId = String(req.query.studentId || '').trim();
    const courseId = String(req.query.courseId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'studentId query parameter is required' });
    if (!courseId) return res.status(400).json({ error: 'courseId query parameter is required' });

    const resolved = await resolveActiveSessionForCourse(courseId);
    if (resolved.error) {
      return res.json({
        studentId,
        courseId,
        sessionId: null,
        attended: false,
        attendanceId: null,
        attendedAt: null,
      });
    }

    const attendanceDate = new Date().toISOString().slice(0, 10);
    const attendance = await Attendance.findOne({
      student: studentId,
      course: courseId,
      session: resolved.session._id,
      attendanceDate,
    }).sort({ timestamp: -1 });

    return res.json({
      studentId,
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
  const { lectureCode: submitted, courseId, lat, lng } = req.body;
  try {
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
    if (!isPointInsideAnyPolygon(Number(lat), Number(lng), resolved.session.polygons || [])) {
      return res.status(400).json({ error: 'You are outside the allowed attendance area' });
    }
    return res.json({ success: true, sessionId: resolved.session._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/record-attendance', async (req, res) => {
  const {
    studentId, lectureCode: submitted, courseId, method, lat, lng,
  } = req.body;
  try {
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
    if (!isPointInsideAnyPolygon(Number(lat), Number(lng), resolved.session.polygons || [])) {
      return res.status(400).json({ error: 'You are outside the allowed attendance area' });
    }

    const normalizedCode = String(submitted).replace(/\s/g, '');
    const attendanceDate = new Date().toISOString().slice(0, 10);
    const existing = await Attendance.findOne({
      student: studentId,
      session: resolved.session._id,
      attendanceDate,
    });
    if (existing) {
      return res.json({ success: true, attendance: existing, duplicate: true });
    }

    const attendance = new Attendance({
      student: studentId,
      course: resolved.course._id,
      session: resolved.session._id,
      courseCode: resolved.course.code,
      lectureCode: normalizedCode,
      attendanceDate,
      method,
      location: { lat: Number(lat), lng: Number(lng) },
    });
    await attendance.save();
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/courses/:courseId/attendance-matrix', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const sessionIds = await Attendance.distinct('session', { course: course._id });
    const sessions = await LectureSession.find({ _id: { $in: sessionIds } }).sort({ lectureDay: 1, startTime: 1 });
    const attendanceDocs = await Attendance.find({ course: course._id, session: { $in: sessionIds } })
      .populate('student', 'studentId email');
    const rowsMap = new Map();
    attendanceDocs.forEach((doc) => {
      const sid = String(doc.student?._id || '');
      if (!sid) return;
      if (!rowsMap.has(sid)) {
        rowsMap.set(sid, {
          studentId: doc.student.studentId,
          email: doc.student.email,
          attendance: {},
        });
      }
      rowsMap.get(sid).attendance[String(doc.session)] = true;
    });
    return res.json({
      course: { _id: course._id, code: course.code, name: course.name },
      sessions: sessions.map((s) => ({
        _id: s._id,
        label: `${s.lectureDay} ${s.startTime}-${s.endTime}`,
      })),
      rows: Array.from(rowsMap.values()),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on ${PORT}`);
});
