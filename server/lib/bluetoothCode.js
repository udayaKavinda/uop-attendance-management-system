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

/**
 * Get or create the rotating token for a session.
 * Persists to MongoDB so tokens survive server restarts.
 */
async function getToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) throw new Error('sessionId required');
  const now = Date.now();
  const Model = getModel();

  let doc = await Model.findOne({ sessionId: key });
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
    { sessionId: key },
    { token, prevToken, generatedAt: now, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  localCache.set(key, { token, prevToken, generatedAt: now });
  return { token, prevToken, rotatesIn: ROTATION_MS / 1000 };
}

/**
 * Verify a submitted token against the current and previous token.
 * Also accepts the previous token within GRACE_MS after rotation boundary.
 */
async function verifyToken(sessionId, submitted) {
  const key = String(sessionId || '').trim();
  const normalized = String(submitted || '').trim().toLowerCase();
  if (!key || !normalized) return false;

  const Model = getModel();
  const doc = await Model.findOne({ sessionId: key });
  if (!doc) return false;

  if (doc.token === normalized) return true;
  // Accept previous token within grace window after rotation
  if (doc.prevToken && doc.prevToken === normalized) {
    const age = Date.now() - doc.generatedAt;
    if (age <= GRACE_MS) return true;
  }
  return false;
}

async function removeToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) return;
  const Model = getModel();
  await Model.deleteOne({ sessionId: key });
  localCache.delete(key);
}

module.exports = { ROTATION_MS, GRACE_MS, generateDeviceName, getToken, verifyToken, removeToken };
