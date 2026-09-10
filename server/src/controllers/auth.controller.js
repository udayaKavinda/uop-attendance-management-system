const passport = require('passport');
const Person = require('../models/Person');
const oauthService = require('../services/oauth.service');
const googleIdentityService = require('../services/googleIdentity.service');
const { EmailDomainRejectedError } = googleIdentityService;
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

/** Hostname shape only — never let anything else reach a redirect URL. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * The browser sign-in flow can only answer with a redirect, so a rejection used
 * to arrive as a bare `?error=auth` and both clients rendered "Sign-in failed.
 * Please try again." — actively wrong for the commonest cause, a non-university
 * address, where retrying can never succeed. (The native ID-token path has
 * always returned the real reason, so the two sign-in routes disagreed.)
 *
 * A fixed set of codes, never the raw message: `err.message` can carry driver
 * or provider internals, and this value lands in a URL.
 */
function oauthFailureQuery(err) {
  if (err instanceof EmailDomainRejectedError) {
    const domain = String(err.domain || '');
    return DOMAIN_RE.test(domain)
      ? `/?error=domain&domain=${encodeURIComponent(domain.toLowerCase())}`
      : '/?error=domain';
  }
  if (err && /no email/i.test(String(err.message || ''))) return '/?error=no_email';
  return '/?error=auth';
}

function googleCallback(req, res, next) {
  const returnBase = String(req.session.oauthReturnBase || oauthService.defaultAppOrigin()).replace(/\/$/, '');
  passport.authenticate('google', (err, user) => {
    if (err || !user) {
      return oauthService.redirectAfterOAuth(res, returnBase, oauthFailureQuery(err), null);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return oauthService.redirectAfterOAuth(res, returnBase, '/?error=session', null);
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
  if (!userId) {
    return res.status(401).json({
      error: 'This sign-in link has already been used or has expired. Start signing in again.',
    });
  }
  const person = await Person.findById(userId);
  if (!person) return res.status(401).json({ error: 'User not found' });
  req.logIn(person, (err) => {
    if (err) return res.status(500).json({ error: 'Signed in, but the session could not be created. Please try again.' });
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
    if (err) return res.status(500).json({ error: 'Signed in, but the session could not be created. Please try again.' });
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
  // Exported for tests: a pure mapper, and the only thing standing between a
  // rejected browser sign-in and a user who is told nothing useful.
  oauthFailureQuery,
};
