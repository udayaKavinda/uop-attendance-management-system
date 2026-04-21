// load environment variables from .env file if present
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const Student = require('./models/Student');
const Attendance = require('./models/Attendance');
const CourseConfig = require('./models/CourseConfig');
const lectureCode = require('./lib/lectureCode');

const ALLOWED_COURSE_CODES = ['EE669', 'EM2020', 'EM503', 'EM526', 'EM1050', 'EM527', 'EM524'];
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

async function resolveCourseConfig(courseCode) {
  const normalizedCourseCode = lectureCode.normalizeCourseCode(courseCode);
  if (!ALLOWED_COURSE_CODES.includes(normalizedCourseCode)) {
    return { error: 'Invalid course code' };
  }
  let config = await CourseConfig.findOne({ courseCode: normalizedCourseCode });
  if (!config) {
    config = await CourseConfig.create({ courseCode: normalizedCourseCode });
  }
  return { config, normalizedCourseCode };
}

function checkScheduleWindow(config) {
  const now = new Date();
  const day = DAY_INDEX[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(config.startTime);
  const end = toMinutes(config.endTime);
  if (start === null || end === null) return { ok: false, reason: 'Invalid schedule config' };
  if (day !== config.lectureDay) return { ok: false, reason: `Attendance allowed only on ${config.lectureDay}` };
  if (currentMinutes < start || currentMinutes > end) {
    return { ok: false, reason: 'Attendance allowed only within the configured lecture time' };
  }
  return { ok: true };
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

app.get('/api/admin/course-configs', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });
    const existing = await CourseConfig.find({ courseCode: { $in: ALLOWED_COURSE_CODES } });
    const map = new Map(existing.map((cfg) => [cfg.courseCode, cfg]));
    const full = ALLOWED_COURSE_CODES.map((courseCode) => map.get(courseCode) || ({
      courseCode,
      lectureDay: 'MON',
      startTime: '08:00',
      endTime: '10:00',
      recurring: true,
      polygon: [],
    }));
    return res.json({ items: full });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/course-configs/:courseCode', async (req, res) => {
  try {
    const auth = await requireAdminByStudentId(req.headers['x-student-id']);
    if (!auth.ok) return res.status(403).json({ error: auth.message });

    const { config, normalizedCourseCode, error } = await resolveCourseConfig(req.params.courseCode);
    if (error) return res.status(400).json({ error });

    const {
      lectureDay, startTime, endTime, recurring, polygon,
    } = req.body || {};
    const allowedDays = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
    if (!allowedDays.includes(String(lectureDay || '').toUpperCase())) {
      return res.status(400).json({ error: 'lectureDay must be MON..FRI' });
    }
    const s = toMinutes(startTime);
    const e = toMinutes(endTime);
    if (s === null || e === null || s >= e) {
      return res.status(400).json({ error: 'Invalid startTime/endTime (HH:mm)' });
    }
    const normalizedPolygon = Array.isArray(polygon)
      ? polygon.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      : [];

    config.courseCode = normalizedCourseCode;
    config.lectureDay = String(lectureDay).toUpperCase();
    config.startTime = startTime;
    config.endTime = endTime;
    config.recurring = Boolean(recurring);
    config.polygon = normalizedPolygon;
    await config.save();

    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** Current rotating lecture code (refreshes every 30s). Use for projector / testing. */
app.get('/api/lecture-code', (req, res) => {
  try {
    const normalizedCourseCode = lectureCode.normalizeCourseCode(req.query.courseCode);
    if (!ALLOWED_COURSE_CODES.includes(normalizedCourseCode)) {
      return res.status(400).json({ error: 'Valid courseCode query parameter is required' });
    }
    res.json(lectureCode.getCurrent(normalizedCourseCode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Returns whether this student already marked attendance for the selected
 * course at any time (database-based status).
 */
app.get('/api/attendance-status', async (req, res) => {
  try {
    const studentId = String(req.query.studentId || '').trim();
    const normalizedCourseCode = lectureCode.normalizeCourseCode(req.query.courseCode);
    if (!studentId) return res.status(400).json({ error: 'studentId query parameter is required' });
    if (!ALLOWED_COURSE_CODES.includes(normalizedCourseCode)) {
      return res.status(400).json({ error: 'Valid courseCode query parameter is required' });
    }

    const attendance = await Attendance.findOne({
      student: studentId,
      courseCode: normalizedCourseCode,
    }).sort({ timestamp: -1 });

    return res.json({
      studentId,
      courseCode: normalizedCourseCode,
      attended: Boolean(attendance),
      attendanceId: attendance?._id || null,
      attendedAt: attendance?.timestamp || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify-lecture', async (req, res) => {
  const { lectureCode: submitted, courseCode, lat, lng } = req.body;
  try {
    const resolved = await resolveCourseConfig(courseCode);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const { normalizedCourseCode, config } = resolved;

    if (!lectureCode.hasValidLocation(lat, lng)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }
    if (!lectureCode.isValidCode(normalizedCourseCode, submitted)) {
      return res.status(400).json({ error: 'Invalid or expired lecture code' });
    }
    const schedule = checkScheduleWindow(config);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!isPointInsidePolygon(Number(lat), Number(lng), config.polygon || [])) {
      return res.status(400).json({ error: 'You are outside the allowed attendance area' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/record-attendance', async (req, res) => {
  const {
    studentId, lectureCode: submitted, courseCode, method, lat, lng,
  } = req.body;
  try {
    const resolved = await resolveCourseConfig(courseCode);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const { normalizedCourseCode, config } = resolved;
    if (!lectureCode.hasValidLocation(lat, lng)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }
    if (!lectureCode.isValidCode(normalizedCourseCode, submitted)) {
      return res.status(400).json({ error: 'Invalid or expired lecture code' });
    }
    const schedule = checkScheduleWindow(config);
    if (!schedule.ok) return res.status(400).json({ error: schedule.reason });
    if (!isPointInsidePolygon(Number(lat), Number(lng), config.polygon || [])) {
      return res.status(400).json({ error: 'You are outside the allowed attendance area' });
    }

    const normalizedCode = String(submitted).replace(/\s/g, '');
    const duplicateCutoff = new Date(Date.now() - lectureCode.ROTATION_MS);
    const existing = await Attendance.findOne({
      student: studentId,
      courseCode: normalizedCourseCode,
      lectureCode: normalizedCode,
      timestamp: { $gte: duplicateCutoff },
    });
    if (existing) {
      return res.json({ success: true, attendance: existing, duplicate: true });
    }

    const attendance = new Attendance({
      student: studentId,
      courseCode: normalizedCourseCode,
      lectureCode: normalizedCode,
      method,
      location: { lat: Number(lat), lng: Number(lng) },
    });
    await attendance.save();
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  lectureCode.startRotationTimer(ALLOWED_COURSE_CODES);
  console.log(`🚀 Server listening on ${PORT}`);
});
