const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Person = require('../models/Person');
const { upsertGooglePerson } = require('../services/googleIdentity.service');

function isGoogleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getCallbackURL() {
  const appBaseUrl = process.env.APP_BASE_URL || '';
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

      // Shared with the Credential Manager ID-token path so both sign-in routes
      // resolve to the SAME Person and can never drift apart.
      const person = await upsertGooglePerson({ email: emailRaw, googleSub: profile.id });
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
