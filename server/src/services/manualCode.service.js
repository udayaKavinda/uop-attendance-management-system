const crypto = require('crypto');

// ManualCode model — loaded lazily so this module can be required before mongoose connects
let ManualCode;
function getModel() {
  if (!ManualCode) ManualCode = require('../models/ManualCode');
  return ManualCode;
}

// isWithinScheduleWindow — required lazily to avoid a require-cycle at module load
// (session.service.js does not require this module, so this is safe either way,
// but lazy keeps the dependency direction obvious).
function isRunning(sessionItem) {
  return require('./session.service').isWithinScheduleWindow(sessionItem);
}

const MIN_ROTATION_SECONDS = 10;
const MAX_ROTATION_SECONDS = 3600;
const GRACE_MS = 2000; // accept the previous code for 2s after an automatic rotation

/** Cryptographically secure 8-digit numeric code, zero-padded (e.g. "00417293"). */
function generateCode() {
  return String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

function rotationIntervalMs(sessionItem) {
  const seconds = Math.max(MIN_ROTATION_SECONDS, Number(sessionItem.manualCodeRotationSeconds) || MIN_ROTATION_SECONDS);
  return seconds * 1000;
}

function toState(doc, sessionItem, now = Date.now()) {
  let rotatesIn = null;
  if (!doc.paused && sessionItem.manualCodeRotationMode === 'interval') {
    const intervalMs = rotationIntervalMs(sessionItem);
    rotatesIn = Math.max(0, Math.ceil((intervalMs - (now - doc.generatedAt)) / 1000));
  }
  return {
    code: doc.code,
    prevCode: doc.prevCode,
    generatedAt: doc.generatedAt,
    paused: doc.paused,
    rotatesIn,
  };
}

/**
 * Forces a brand-new code right now, bypassing the normal rotation-interval check.
 * `keepGrace: true` lets the previous code still work for GRACE_MS (used when the
 * interval itself changes); `keepGrace: false` kills the old code immediately (used
 * by resume-from-pause and manual regenerate — see rotation-behaviour decisions in
 * docs/attendance-verification-design.md).
 */
async function forceRotate(sessionItem, { keepGrace }) {
  const key = String(sessionItem._id);
  const Model = getModel();
  const existing = await Model.findOne({ session: key });
  const code = generateCode();
  const doc = await Model.findOneAndUpdate(
    { session: key },
    {
      code,
      prevCode: keepGrace ? (existing?.code || null) : null,
      generatedAt: Date.now(),
      paused: false,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

/**
 * Get the live code, rotating it first if the configured interval has elapsed.
 * Creates the row on first call after the feature is enabled. Assumes the caller
 * has already confirmed the session is enabled and running — this function does
 * not itself gate on either.
 */
async function getOrRotateCode(sessionItem) {
  const key = String(sessionItem._id);
  const now = Date.now();
  const Model = getModel();
  let doc = await Model.findOne({ session: key });

  if (!doc) {
    doc = await forceRotate(sessionItem, { keepGrace: false });
    return toState(doc, sessionItem, now);
  }

  if (doc.paused || sessionItem.manualCodeRotationMode !== 'interval') {
    return toState(doc, sessionItem, now);
  }

  const intervalMs = rotationIntervalMs(sessionItem);
  if (now - doc.generatedAt < intervalMs) {
    return toState(doc, sessionItem, now);
  }

  doc = await Model.findOneAndUpdate(
    { session: key },
    { code: generateCode(), prevCode: doc.code, generatedAt: now },
    { new: true },
  );
  return toState(doc, sessionItem, now);
}

/**
 * Staff-facing view: config + live state. Every session has a code now — the
 * only gate left is the schedule window, since outside it there is no live
 * lecture to vouch for anyone (matches "ending the session invalidates it").
 */
async function getStatus(sessionItem) {
  const base = {
    rotationMode: sessionItem.manualCodeRotationMode,
    rotationSeconds: sessionItem.manualCodeRotationSeconds,
  };
  if (!isRunning(sessionItem)) {
    return {
      ...base, running: false, paused: false, code: null, rotatesIn: null,
    };
  }
  const state = await getOrRotateCode(sessionItem);
  return {
    ...base,
    running: true,
    paused: state.paused,
    code: state.code,
    rotatesIn: state.rotatesIn,
  };
}

async function removeCode(sessionItem) {
  const key = String(sessionItem?._id || '');
  if (!key) return;
  await getModel().deleteOne({ session: key });
}

/** Changing the interval mid-session rotates immediately, with the usual grace window. */
async function setRotation(sessionItem, { rotationMode, rotationSeconds }) {
  sessionItem.manualCodeRotationMode = rotationMode;
  sessionItem.manualCodeRotationSeconds = rotationSeconds;
  await sessionItem.save();
  if (isRunning(sessionItem)) {
    await forceRotate(sessionItem, { keepGrace: true });
  }
  return sessionItem;
}

async function pause(sessionItem) {
  const key = String(sessionItem._id);
  await getModel().findOneAndUpdate({ session: key }, { paused: true });
}

/** No grace window: the whole point is a code shared during the pause stops working. */
async function resume(sessionItem) {
  await forceRotate(sessionItem, { keepGrace: false });
}

/** No grace window: staff hit this because they suspect the current code already leaked. */
async function regenerate(sessionItem) {
  await forceRotate(sessionItem, { keepGrace: false });
}

/**
 * Verifies a submitted 8-digit code against the session's live state (current code,
 * or the previous one within the automatic-rotation grace window). Does not itself
 * check the schedule window — callers that already hold a confirmed-running
 * sessionItem (e.g. attendance.service's resolveActiveSessionForCourse result) can
 * call straight through; call getStatus()/isRunning() first otherwise.
 */
async function verifyCode(sessionItem, submitted) {
  const normalized = String(submitted || '').trim();
  if (!/^[0-9]{8}$/.test(normalized)) return false;

  const state = await getOrRotateCode(sessionItem);
  if (state.code === normalized) return true;
  if (state.prevCode && state.prevCode === normalized) {
    const age = Date.now() - state.generatedAt;
    if (age <= GRACE_MS) return true;
  }
  return false;
}

// ── Per-(student, session) guess limiting ───────────────────────────────────
// In-memory Map, single-process only — same scaling caveat as the OAuth exchange-
// code store and the sign-in nonce store (move to Redis to scale out).

const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 2 * 60 * 1000;
const attemptStore = new Map();

function attemptKey(studentId, sessionId) {
  return `${studentId}:${sessionId}`;
}

function isLockedOut(studentId, sessionId) {
  const rec = attemptStore.get(attemptKey(studentId, sessionId));
  return Boolean(rec?.lockedUntil && Date.now() < rec.lockedUntil);
}

function recordFailedAttempt(studentId, sessionId) {
  const key = attemptKey(studentId, sessionId);
  const now = Date.now();
  let rec = attemptStore.get(key);
  if (!rec || now - rec.firstAt > ATTEMPT_WINDOW_MS) {
    rec = { count: 0, firstAt: now, lockedUntil: 0 };
  }
  rec.count += 1;
  if (rec.count >= ATTEMPT_LIMIT) rec.lockedUntil = now + LOCKOUT_MS;
  attemptStore.set(key, rec);
}

function clearAttempts(studentId, sessionId) {
  attemptStore.delete(attemptKey(studentId, sessionId));
}

const attemptSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of attemptStore) {
    const expired = now - rec.firstAt > ATTEMPT_WINDOW_MS;
    const unlocked = !rec.lockedUntil || now > rec.lockedUntil;
    if (expired && unlocked) attemptStore.delete(key);
  }
}, 5 * 60 * 1000);
if (typeof attemptSweep.unref === 'function') attemptSweep.unref();

/** Combines the attempt cap with code verification; clears the cap on success. */
async function verifyAttempt(studentId, sessionItem, submitted) {
  const sessionKey = String(sessionItem._id);
  if (isLockedOut(studentId, sessionKey)) {
    return { ok: false, lockedOut: true };
  }
  const valid = await verifyCode(sessionItem, submitted);
  if (!valid) {
    recordFailedAttempt(studentId, sessionKey);
    return { ok: false, lockedOut: false };
  }
  clearAttempts(studentId, sessionKey);
  return { ok: true, lockedOut: false };
}

module.exports = {
  MIN_ROTATION_SECONDS,
  MAX_ROTATION_SECONDS,
  GRACE_MS,
  generateCode,
  getOrRotateCode,
  getStatus,
  removeCode,
  setRotation,
  pause,
  resume,
  regenerate,
  verifyCode,
  verifyAttempt,
};
