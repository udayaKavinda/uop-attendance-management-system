// load environment variables from .env file if present
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

// load models (will create below)
const Student = require('./models/Student');
const Attendance = require('./models/Attendance');

// WebAuthn RP config: origin and rpID (for ngrok, set FRONTEND_URL to ngrok URL; rpID derived from it if not set)
const origin = process.env.WEBAUTHN_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:3000';
const rpID = process.env.WEBAUTHN_RP_ID || (() => {
  try {
    const u = new URL(origin);
    return u.hostname;
  } catch {
    return 'localhost';
  }
})();
const rpName = process.env.WEBAUTHN_RP_NAME || 'UOP Attendance';

// In-memory challenge store (keyed by studentId); use Redis in production
const webauthnChallenges = new Map();
function setChallenge(studentId, data) {
  webauthnChallenges.set(studentId, data);
  setTimeout(() => webauthnChallenges.delete(studentId), 5 * 60 * 1000);
}
function getChallenge(studentId) {
  const data = webauthnChallenges.get(studentId);
  webauthnChallenges.delete(studentId);
  return data;
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
  // With ngrok, backend has a public URL; Google needs the full callback URL
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
          studentId: profile.id, // in a real app you'd generate or map properly
        });
      }
      return done(null, student);
    } catch (err) {
      return done(err);
    }
  }));

  // authentication routes
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

// connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance')
  .then(() => console.log('🗄  MongoDB connected'))
  .catch((err) => console.error('Mongo connection error', err));

// --- routes ---

// 1. login: accept email or student id and return student profile
app.post('/api/login', async (req, res) => {
  const { identifier } = req.body; // email or studentId
  // TODO: look up student and return basic info
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

// 2. device verification (webauthn is verified via /api/webauthn/*; this records the method)
app.post('/api/verify-device', (req, res) => {
  const { method } = req.body;
  if (method === 'webauthn') {
    // Real verification is done in WebAuthn auth/register-verify; this just records choice
    return res.json({ success: true, method: 'webauthn' });
  }
  // Photo fallback: TODO implement photo verification
  res.json({ success: true, method: req.body.method || 'photo' });
});

// --- WebAuthn (biometric) routes ---

// Get options: registration (if no credentials) or authentication
app.get('/api/webauthn/options', async (req, res) => {
  const studentId = req.query.studentId;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });
  try {
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const credentials = student.webAuthnCredentials || [];
    const isRegistration = credentials.length === 0;

    if (isRegistration) {
      // Only allow platform biometrics (fingerprint or face), not security keys
      const userIdBuffer = Buffer.from(studentId, 'utf8');
      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new Uint8Array(userIdBuffer),
        userName: student.email,
        userDisplayName: student.email,
        attestationType: 'none',
        supportedAlgorithmIDs: [-7, -257],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',   // fingerprint or face required
          authenticatorAttachment: 'platform',  // device built-in only (no USB keys)
        },
      });
      setChallenge(studentId, { type: 'registration', challenge: options.challenge, options });
      return res.json({ type: 'registration', options });
    }

    const allowCredentials = credentials.map((c) => ({
      id: c.id,
      transports: c.transports,
    }));
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: allowCredentials.length ? allowCredentials : undefined,
      userVerification: 'required',  // require fingerprint or face at sign-in
    });
    setChallenge(studentId, { type: 'authentication', challenge: options.challenge });
    return res.json({ type: 'authentication', options });
  } catch (err) {
    console.error('WebAuthn options error', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify registration response and store credential
app.post('/api/webauthn/register-verify', async (req, res) => {
  const { studentId, credential } = req.body;
  if (!studentId || !credential) return res.status(400).json({ error: 'studentId and credential required' });
  const stored = getChallenge(studentId);
  if (!stored || stored.type !== 'registration') return res.status(400).json({ error: 'No registration in progress or expired' });
  try {
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ verified: false, error: 'Verification failed' });
    }
    const { credential: regCred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const webauthnUserID = stored.options.user.id; // base64url from options
    student.webAuthnCredentials = student.webAuthnCredentials || [];
    student.webAuthnCredentials.push({
      id: regCred.id,
      publicKey: Buffer.from(regCred.publicKey),
      counter: regCred.counter,
      transports: regCred.transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      webauthnUserID,
    });
    await student.save();
    return res.json({ verified: true });
  } catch (err) {
    console.error('WebAuthn register-verify error', err);
    res.status(400).json({ verified: false, error: err.message });
  }
});

// Verify authentication response
app.post('/api/webauthn/auth-verify', async (req, res) => {
  const { studentId, assertion } = req.body;
  if (!studentId || !assertion) return res.status(400).json({ error: 'studentId and assertion required' });
  const stored = getChallenge(studentId);
  if (!stored || stored.type !== 'authentication') return res.status(400).json({ error: 'No authentication in progress or expired' });
  try {
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const cred = (student.webAuthnCredentials || []).find((c) => c.id === assertion.id);
    if (!cred) return res.status(400).json({ verified: false, error: 'Credential not found' });
    const publicKey = cred.publicKey instanceof Buffer ? new Uint8Array(cred.publicKey) : cred.publicKey;
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey,
        counter: cred.counter,
        transports: cred.transports,
      },
    });
    if (!verification.verified) return res.status(400).json({ verified: false });
    const { newCounter } = verification.authenticationInfo;
    const idx = student.webAuthnCredentials.findIndex((c) => c.id === assertion.id);
    if (idx >= 0) student.webAuthnCredentials[idx].counter = newCounter;
    await student.save();
    return res.json({ verified: true });
  } catch (err) {
    console.error('WebAuthn auth-verify error', err);
    res.status(400).json({ verified: false, error: err.message });
  }
});

// 3. lecture code & geofencing
app.post('/api/verify-lecture', (req, res) => {
  const { lectureCode, lat, lng } = req.body;
  // TODO: check code validity and location
  const valid = true; // placeholder
  const inside = true; // placeholder
  if (!valid) return res.status(400).json({ error: 'Invalid code' });
  if (!inside) return res.status(400).json({ error: 'Out of bounds' });
  res.json({ success: true });
});

// 4. record attendance
app.post('/api/record-attendance', async (req, res) => {
  const { studentId, lectureCode, method, lat, lng } = req.body;
  try {
    const attendance = new Attendance({
      student: studentId,
      lectureCode,
      method,
      location: { lat, lng },
    });
    await attendance.save();
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
