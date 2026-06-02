const crypto = require('crypto');

const ROTATION_MS = 15000;

const store = new Map(); // sessionId -> { token, generatedAt }

// Automatically rotate every active token once its window expires.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.generatedAt >= ROTATION_MS) {
      store.set(key, { token: crypto.randomBytes(8).toString('hex'), generatedAt: now });
    }
  }
}, 1000);

function generateDeviceName() {
  return 'UOP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) throw new Error('sessionId required');
  const now = Date.now();
  const existing = store.get(key);
  if (existing && now - existing.generatedAt < ROTATION_MS) {
    return {
      token: existing.token,
      rotatesIn: Math.ceil((ROTATION_MS - (now - existing.generatedAt)) / 1000),
    };
  }
  const token = crypto.randomBytes(8).toString('hex');
  store.set(key, { token, generatedAt: now });
  return { token, rotatesIn: ROTATION_MS / 1000 };
}

function verifyToken(sessionId, token) {
  const key = String(sessionId || '').trim();
  const existing = store.get(key);
  if (!existing) return false;
  return existing.token === String(token || '').trim().toLowerCase();
}

function removeToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (key) store.delete(key);
}

module.exports = { ROTATION_MS, generateDeviceName, getToken, verifyToken, removeToken };
