const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Person = require('../models/Person');
const { escapeRegex } = require('../utils/regex');

function isGoogleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getCallbackURL() {
  const appBaseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || process.env.REACT_APP_API_BASE || '';
  return appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/auth/google/callback` : '/auth/google/callback';
}

function configureGoogleStrategy() {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: getCallbackURL(),
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

      // Emails are unique, so the lecturer record (if any) is this same `person`
      // document — no second query needed. Demote a lecturer whose account is no
      // longer active/present to a plain student.
      const isActiveLecturer = person.role === 'lecturer' && person.active === true && person.deleted === false;
      if (!isActiveLecturer && person.role === 'lecturer') {
        person.role = 'student';
        await person.save();
      }

      return done(null, person);
    } catch (err) {
      return done(err);
    }
  }));
}

function applyPassport(app) {
  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser(async (id, done) => {
    try {
      const person = await Person.findById(id);
      done(null, person);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  if (!isGoogleOAuthConfigured()) {
    console.warn('Google OAuth environment variables missing; /auth/google routes will not work');
    return false;
  }

  configureGoogleStrategy();
  return true;
}

module.exports = {
  applyPassport,
  isGoogleOAuthConfigured,
};
