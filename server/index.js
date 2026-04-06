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
const lectureCode = require('./lib/lectureCode');

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
  const backendBase = process.env.REACT_APP_API_BASE || process.env.BACKEND_PUBLIC_URL || '';
  const callbackURL = backendBase
    ? `${backendBase.replace(/\/$/, '')}/auth/google/callback`
    : '/auth/google/callback';

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
        student = await Student.create({
          email,
          studentId: profile.id,
        });
      }
      return done(null, student);
    } catch (err) {
      return done(err);
    }
  }));

  app.get('/auth/google', passport.authenticate('google', { scope: ['email'] }));
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
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

/** Current rotating lecture code (refreshes every 30s). Use for projector / testing. */
app.get('/api/lecture-code', (req, res) => {
  try {
    res.json(lectureCode.getCurrent());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify-lecture', (req, res) => {
  const { lectureCode: submitted, lat, lng } = req.body;
  if (!lectureCode.hasValidLocation(lat, lng)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  if (!lectureCode.isValidCode(submitted)) {
    return res.status(400).json({ error: 'Invalid or expired lecture code' });
  }
  const inside = true;
  if (!inside) return res.status(400).json({ error: 'Out of bounds' });
  res.json({ success: true });
});

app.post('/api/record-attendance', async (req, res) => {
  const { studentId, lectureCode: submitted, method, lat, lng } = req.body;
  if (!lectureCode.hasValidLocation(lat, lng)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  if (!lectureCode.isValidCode(submitted)) {
    return res.status(400).json({ error: 'Invalid or expired lecture code' });
  }
  try {
    const attendance = new Attendance({
      student: studentId,
      lectureCode: String(submitted).replace(/\s/g, ''),
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
  lectureCode.startRotationTimer();
  console.log(`🚀 Server listening on ${PORT}`);
});
