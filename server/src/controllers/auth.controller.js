const passport = require('passport');
const Person = require('../models/Person');
const oauthService = require('../services/oauth.service');
const googleIdentityService = require('../services/googleIdentity.service');
const { validateExchangeCode, validateGoogleIdToken } = require('../validators/oauth.validator');
const { respondError } = require('../middlewares/errorHandler');

function googleNotConfigured(req, res) {
  res.status(503).json({
    error: 'Google OAuth not configured',
    message: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env and restart the server.',
  });
}

function googleAuth(req, res, next) {
  req.session.oauthReturnBase = oauthService.pickOAuthReturnBase(req);
  req.session.save((err) => {
    if (err) return next(err);
    // Server is native-app only; always show Google's account picker so sign-out
    // does not silently re-use the Custom Tab's cached Google session.
    passport.authenticate('google', {
      scope: ['email'],
      prompt: 'select_account',
    })(req, res, next);
  });
}

function nativeReturn(req, res) {
  // Exact structural validation, not a prefix match — see parseNativeReturnTarget.
  const parsed = oauthService.parseNativeReturnTarget(req.query.target);
  if (!parsed) {
    return res.status(400).send('Invalid return target');
  }
  // The page carries no script of its own any more (the redirect is a meta
  // refresh), so this can be the strictest policy there is rather than the
  // `script-src 'unsafe-inline'` the old inline redirect needed — which was what
  // made the target-injection bug executable in the first place.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(oauthService.buildNativeReturnHtml(parsed));
}

function googleCallback(req, res, next) {
  const returnBase = String(req.session.oauthReturnBase || oauthService.defaultAppOrigin()).replace(/\/$/, '');
  passport.authenticate('google', (err, user) => {
    if (err || !user) {
      return oauthService.redirectAfterOAuth(res, returnBase, '/?error=auth', null);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return oauthService.redirectAfterOAuth(res, returnBase, '/?error=auth', null);
      }
      delete req.session.oauthReturnBase;
      return oauthService.redirectAfterOAuth(res, returnBase, '/login/success', user._id);
    });
  })(req, res, next);
}

async function exchangeCode(req, res) {
  const validated = validateExchangeCode(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const userId = oauthService.consumeOAuthExchangeCode(validated.code);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired code' });
  const person = await Person.findById(userId);
  if (!person) return res.status(401).json({ error: 'User not found' });
  req.logIn(person, (err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    return res.json({ success: true });
  });
}

/**
 * Step 1 of Credential Manager sign-in: hand the app a single-use nonce that
 * Google will embed in the ID token, so a replayed token cannot be reused.
 */
function googleNonce(req, res) {
  if (!googleIdentityService.isIdTokenSignInConfigured()) {
    return res.status(503).json({
      error: 'Google sign-in not configured',
      message: 'Add GOOGLE_CLIENT_ID to .env and restart the server.',
    });
  }
  return res.json({ nonce: googleIdentityService.issueSignInNonce() });
}

/**
 * Step 2 of Credential Manager sign-in: verify the Google ID token the app got
 * natively, then establish the SAME Passport session the Custom Tab flow does —
 * so every downstream route, guard and cookie behaves identically.
 */
async function googleIdToken(req, res) {
  const validated = validateGoogleIdToken(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });

  const result = await googleIdentityService.signInWithGoogleIdToken(validated.idToken);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  req.logIn(result.person, (err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    return res.json({ success: true });
  });
}

async function me(req, res) {
  const person = req.auth.person;
  return res.json({
    studentId: person._id,
    email: person.email,
    role: person.role,
    lecturerId: person.role === 'lecturer' ? person._id : null,
  });
}

function logout(req, res) {
  req.logout((err) => {
    if (err) return respondError(res, err);
    return res.json({ success: true });
  });
}

module.exports = {
  googleNotConfigured,
  googleAuth,
  nativeReturn,
  googleCallback,
  exchangeCode,
  googleNonce,
  googleIdToken,
  me,
  logout,
};
