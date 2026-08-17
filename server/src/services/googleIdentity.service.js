const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const Person = require('../models/Person');
const { escapeRegex } = require('../utils/regex');

/**
 * Shared Google identity logic for BOTH sign-in paths:
 *
 *  1. Credential Manager (current)  — the Android app obtains a Google ID token
 *     natively and POSTs it to `/api/auth/google-id-token`.
 *  2. Custom Tab OAuth (fallback)   — Passport's Google strategy calls
 *     `upsertGooglePerson` from its verify callback.
 *
 * Keeping the Person find-or-create rules in one place means the two paths can
 * never drift apart and always resolve to the SAME Person document.
 */

/**
 * Google signs the ID token with an audience of the **Web** OAuth client id —
 * the Android app passes that same value as `serverClientId`, so verification
 * reuses GOOGLE_CLIENT_ID. Note the client *secret* is not needed to verify.
 */
function googleClientId() {
  return (process.env.GOOGLE_CLIENT_ID || '').trim();
}

/** ID-token sign-in only needs the client id (no secret), unlike the OAuth flow. */
function isIdTokenSignInConfigured() {
  return Boolean(googleClientId());
}

let cachedClient = null;
function verifierClient() {
  if (!cachedClient) cachedClient = new OAuth2Client(googleClientId());
  return cachedClient;
}

// ── Sign-in nonce (replay protection) ────────────────────────────────────────
// The app fetches a nonce, hands it to Credential Manager, and Google embeds it
// in the ID token. Verifying it here means a leaked/replayed token is useless.
//
// In-memory Map, single-process only — same scaling caveat as the OAuth
// exchange-code store and the session-resolve cache (move to Redis to scale out).

const NONCE_TTL_MS = 5 * 60 * 1000;
const signInNonces = new Map();

function issueSignInNonce() {
  const nonce = crypto.randomBytes(32).toString('hex');
  signInNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return nonce;
}

/** Single-use: returns true only for a known, unexpired nonce. */
function consumeSignInNonce(nonce) {
  const expires = signInNonces.get(nonce);
  if (!expires) return false;
  signInNonces.delete(nonce);
  return expires >= Date.now();
}

const nonceSweep = setInterval(() => {
  const now = Date.now();
  for (const [nonce, expires] of signInNonces) {
    if (expires < now) signInNonces.delete(nonce);
  }
}, 5 * 60 * 1000);
if (typeof nonceSweep.unref === 'function') nonceSweep.unref();

// ── Person resolution ────────────────────────────────────────────────────────

/**
 * Find-or-create the Person for a verified Google identity.
 *
 * `googleSub` is Google's stable subject id — identical to Passport's
 * `profile.id`, so an account created through the Custom Tab flow resolves to
 * the same Person here (no duplicate accounts across the two paths).
 *
 * Deliberately does NOT write `name` from the Google profile: lecturer display
 * names are curated by admins and must not be overwritten at sign-in.
 */
async function upsertGooglePerson({ email, googleSub }) {
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm) throw new Error('No email in Google profile');

  let person = await Person.findOne({ email: emailNorm });
  if (!person) {
    person = await Person.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(emailNorm)}$`, 'i') },
    });
  }
  if (!person) {
    person = await Person.create({
      email: emailNorm,
      studentId: googleSub,
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
      person.studentId = googleSub;
      changed = true;
    } else if (!person.studentId) {
      person.studentId = googleSub;
      changed = true;
    }
    if (!person.role) {
      person.role = 'student';
      changed = true;
    }
    if (changed) await person.save();
  }

  // Emails are unique, so the lecturer record (if any) is this same `person`
  // document. Demote a lecturer whose account is no longer active/present.
  const isActiveLecturer = person.role === 'lecturer' && person.active === true && person.deleted === false;
  if (!isActiveLecturer && person.role === 'lecturer') {
    person.role = 'student';
    await person.save();
  }

  return person;
}

// ── ID token verification ────────────────────────────────────────────────────

/**
 * Verifies a Google ID token from Credential Manager and resolves it to a Person.
 * Returns a `{ ok, ... }` result object (service-layer convention) rather than throwing.
 */
async function signInWithGoogleIdToken(idToken, expectedNonce) {
  if (!isIdTokenSignInConfigured()) {
    return { ok: false, status: 503, error: 'Google sign-in is not configured on this server' };
  }

  let payload;
  try {
    const ticket = await verifierClient().verifyIdToken({
      idToken,
      audience: googleClientId(),
    });
    payload = ticket.getPayload();
  } catch (err) {
    // Bad signature, wrong audience, expired token, clock skew, etc.
    return { ok: false, status: 401, error: 'Invalid Google token' };
  }

  if (!payload) return { ok: false, status: 401, error: 'Invalid Google token' };

  // verifyIdToken already checks `iss`, but assert it explicitly for clarity.
  const iss = String(payload.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    return { ok: false, status: 401, error: 'Invalid Google token' };
  }

  // Replay protection: the nonce must be one we issued and have not yet consumed.
  if (!payload.nonce || !consumeSignInNonce(String(payload.nonce))) {
    return { ok: false, status: 401, error: 'Sign-in expired, please try again' };
  }

  if (expectedNonce && String(payload.nonce) !== String(expectedNonce)) {
    return { ok: false, status: 401, error: 'Sign-in expired, please try again' };
  }

  const email = payload.email;
  if (!email) return { ok: false, status: 401, error: 'Google account has no email address' };
  if (payload.email_verified === false) {
    return { ok: false, status: 403, error: 'Google account email is not verified' };
  }

  const person = await upsertGooglePerson({ email, googleSub: payload.sub });
  return { ok: true, person };
}

module.exports = {
  isIdTokenSignInConfigured,
  issueSignInNonce,
  consumeSignInNonce,
  upsertGooglePerson,
  signInWithGoogleIdToken,
};
