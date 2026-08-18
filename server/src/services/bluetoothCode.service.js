const crypto = require('crypto');

// BleToken model — loaded lazily so this module can be required before mongoose connects
let BleToken;
function getModel() {
  if (!BleToken) BleToken = require('../models/BleToken');
  return BleToken;
}

const ROTATION_MS = 15000;
const GRACE_MS = 2000; // accept previous token for 2 s after rotation

// In-memory fallback for operations that happen before first DB call
const localCache = new Map();

function generateDeviceName() {
  return 'UOP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ── Primary token (lecturer broadcast) ──────────────────────────────────────────

/**
 * Get or create the rotating primary token for a session.
 * Persists to MongoDB so tokens survive server restarts.
 */
async function getToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) throw new Error('sessionId required');
  const now = Date.now();
  const Model = getModel();
  const filter = { sessionId: key, owner: null, role: 'primary' };

  let doc = await Model.findOne(filter);
  if (doc && now - doc.generatedAt < ROTATION_MS) {
    return {
      token: doc.token,
      prevToken: doc.prevToken,
      rotatesIn: Math.ceil((ROTATION_MS - (now - doc.generatedAt)) / 1000),
    };
  }

  // Rotate
  const prevToken = doc?.token || null;
  const token = crypto.randomBytes(8).toString('hex');
  doc = await Model.findOneAndUpdate(
    filter,
    { token, prevToken, generatedAt: now, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  localCache.set(key, { token, prevToken, generatedAt: now });
  return { token, prevToken, rotatesIn: ROTATION_MS / 1000 };
}

/**
 * Verify a submitted token against every live row in the session's token pool
 * (the primary broadcast plus any active peer seeders) — a match on ANY row's
 * current or (within GRACE_MS) previous token is accepted.
 */
async function verifyToken(sessionId, submitted) {
  const key = String(sessionId || '').trim();
  const normalized = String(submitted || '').trim().toLowerCase();
  if (!key || !normalized) return false;

  const Model = getModel();
  const docs = await Model.find({ sessionId: key });
  const now = Date.now();

  return docs.some((doc) => {
    if (doc.role === 'seed' && doc.leaseUntil != null && now >= doc.leaseUntil) return false;
    if (doc.token === normalized) return true;
    if (doc.prevToken && doc.prevToken === normalized) {
      return now - doc.generatedAt <= GRACE_MS;
    }
    return false;
  });
}

/** Removes the ENTIRE pool for a session — primary token and every seeder. Full teardown. */
async function removeToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) return;
  const Model = getModel();
  await Model.deleteMany({ sessionId: key });
  localCache.delete(key);
}

// ── Seed tokens (peer seeding) ──────────────────────────────────────────────────

/** Mints (or resets) one student's seeder token for a session, with a lease. */
async function mintSeedToken(sessionId, ownerId, leaseUntil) {
  const key = String(sessionId || '').trim();
  const owner = String(ownerId || '').trim();
  if (!key || !owner) throw new Error('sessionId and ownerId required');
  const token = crypto.randomBytes(8).toString('hex');
  const doc = await getModel().findOneAndUpdate(
    { sessionId: key, owner, role: 'seed' },
    {
      token, prevToken: null, generatedAt: Date.now(), leaseUntil, updatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { token: doc.token, leaseUntil: doc.leaseUntil };
}

/**
 * Rotate-on-read for one seeder's token, mirroring [getToken]'s cadence — called
 * on the seeder phone's ~5s re-fetch poll (which also doubles as its heartbeat).
 * Returns null once the lease has expired; callers should stop advertising and
 * let the sweep remove the row.
 */
async function getSeedToken(sessionId, ownerId) {
  const key = String(sessionId || '').trim();
  const owner = String(ownerId || '').trim();
  if (!key || !owner) return null;
  const now = Date.now();
  const Model = getModel();
  const filter = { sessionId: key, owner, role: 'seed' };

  const doc = await Model.findOne(filter);
  if (!doc) return null;
  if (doc.leaseUntil != null && now >= doc.leaseUntil) return null;

  if (now - doc.generatedAt < ROTATION_MS) {
    return {
      token: doc.token, prevToken: doc.prevToken, leaseUntil: doc.leaseUntil, rotatesIn: Math.ceil((ROTATION_MS - (now - doc.generatedAt)) / 1000),
    };
  }
  const token = crypto.randomBytes(8).toString('hex');
  const updated = await Model.findOneAndUpdate(
    filter,
    { token, prevToken: doc.token, generatedAt: now, updatedAt: new Date() },
    { new: true },
  );
  return {
    token: updated.token, prevToken: updated.prevToken, leaseUntil: updated.leaseUntil, rotatesIn: ROTATION_MS / 1000,
  };
}

async function removeSeedToken(sessionId, ownerId) {
  const key = String(sessionId || '').trim();
  const owner = String(ownerId || '').trim();
  if (!key || !owner) return;
  await getModel().deleteOne({ sessionId: key, owner, role: 'seed' });
}

/** Live (non-expired) seeder count for a session, for the seeder-selection algorithm. */
async function countLiveSeeders(sessionId, now = Date.now()) {
  const key = String(sessionId || '').trim();
  if (!key) return 0;
  return getModel().countDocuments({
    sessionId: key,
    role: 'seed',
    $or: [{ leaseUntil: null }, { leaseUntil: { $gt: now } }],
  });
}

/** Bulk-removes every expired-lease seeder row across all sessions — the background sweep. */
async function removeExpiredSeedTokens(now = Date.now()) {
  return getModel().deleteMany({ role: 'seed', leaseUntil: { $ne: null, $lte: now } });
}

module.exports = {
  ROTATION_MS,
  GRACE_MS,
  generateDeviceName,
  getToken,
  verifyToken,
  removeToken,
  mintSeedToken,
  getSeedToken,
  removeSeedToken,
  countLiveSeeders,
  removeExpiredSeedTokens,
};
