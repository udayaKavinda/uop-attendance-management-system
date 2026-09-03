const crypto = require('crypto');

// BleToken model — loaded lazily so this module can be required before mongoose connects
let BleToken;
function getModel() {
  if (!BleToken) BleToken = require('../models/BleToken');
  return BleToken;
}

const ROTATION_MS = 15000;
/**
 * How long the PREVIOUS token stays acceptable after a rotation.
 *
 * Must exceed the broadcaster's poll interval (5 s), because rotation is lazy:
 * it happens on the first poll that finds the token older than ROTATION_MS, and
 * only that caller gets the new value back. With several devices broadcasting
 * the same session (the "Join" action) every other device keeps advertising the
 * old token until its own next poll — up to a full poll interval later. A 2 s
 * grace left a ~3 s window per 15 s cycle in which a joined phone advertised a
 * token this service would reject, so a student who happened to hear only that
 * phone was turned away (measured: up to 20% of wall-clock time, depending on
 * when the second device joined).
 *
 * 8 s = 5 s poll + 3 s margin for network latency and timer drift. The cost is
 * that a captured token stays replayable ~6 s longer, which is acceptable: the
 * token only ever proves room presence, and it still dies well inside the
 * rotation period.
 */
const GRACE_MS = 8000;

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
  return { token, prevToken, rotatesIn: ROTATION_MS / 1000 };
}

/**
 * Verify a submitted token against every live row in the session's token pool
 * (the primary broadcast plus any active peer seeders) — a match on ANY row's
 * current or (within GRACE_MS) previous token is accepted.
 *
 * Reports WHICH row matched, because that decides seeding eligibility: only a
 * student who heard the lecturer's own primary token is provably in the room and
 * may seed. Re-seeding from a student who themselves heard a seeder would grow
 * the effective radius hop by hop.
 *
 * @returns {Promise<{ ok: boolean, role: 'primary'|'seed'|null }>}
 */
async function verifyToken(sessionId, submitted) {
  const key = String(sessionId || '').trim();
  const normalized = String(submitted || '').trim().toLowerCase();
  if (!key || !normalized) return { ok: false, role: null };

  const Model = getModel();
  const docs = await Model.find({ sessionId: key });
  const now = Date.now();

  const matches = (doc) => {
    if (doc.role === 'seed' && doc.leaseUntil != null && now >= doc.leaseUntil) return false;
    if (doc.token === normalized) return true;
    if (doc.prevToken && doc.prevToken === normalized) {
      return now - doc.generatedAt <= GRACE_MS;
    }
    return false;
  };

  // Prefer a primary match: if the same value somehow lives in both pools, the
  // stronger provenance wins.
  const matched = docs.filter(matches);
  if (matched.length === 0) return { ok: false, role: null };
  const primary = matched.find((doc) => doc.role !== 'seed');
  return { ok: true, role: primary ? 'primary' : 'seed' };
}

/** Removes the ENTIRE pool for a session — primary token and every seeder. Full teardown. */
async function removeToken(sessionId) {
  const key = String(sessionId || '').trim();
  if (!key) return;
  const Model = getModel();
  await Model.deleteMany({ sessionId: key });
}

// ── Seed tokens (peer seeding) ──────────────────────────────────────────────────

/**
 * Atomically takes one of the session's `maxSeeders` seeder slots and mints that
 * seeder's token, or returns null when every slot is already held by a live
 * lease. Replaces the old count-then-mint pair, which was a check-then-act race:
 * see the `slot` field on the BleToken model for the measured effect.
 *
 * A slot is claimed by upserting on `{sessionId, role:'seed', slot}` with a
 * filter that only matches a free or expired row. Concurrent claimants for the
 * same slot therefore all attempt an insert and the unique index picks exactly
 * one winner; every loser gets E11000 and tries the next slot. The cap holds no
 * matter how many students are accepted in the same millisecond.
 */
async function claimSeedSlot(sessionId, ownerId, leaseUntil, maxSeeders, now = Date.now()) {
  const key = String(sessionId || '').trim();
  const owner = String(ownerId || '').trim();
  if (!key || !owner) throw new Error('sessionId and ownerId required');
  if (!Number.isFinite(maxSeeders) || maxSeeders <= 0) return null;
  const Model = getModel();

  // Already holding a slot (a re-accept within the same lecture): refresh that
  // row rather than consuming a second slot.
  const existing = await Model.findOne({ sessionId: key, owner, role: 'seed' });
  if (existing) {
    existing.token = crypto.randomBytes(8).toString('hex');
    existing.prevToken = null;
    existing.generatedAt = now;
    existing.leaseUntil = leaseUntil;
    existing.updatedAt = new Date();
    await existing.save();
    return { token: existing.token, leaseUntil: existing.leaseUntil, slot: existing.slot };
  }

  for (let slot = 0; slot < maxSeeders; slot += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const doc = await Model.findOneAndUpdate(
        {
          sessionId: key,
          role: 'seed',
          slot,
          $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
        },
        {
          $set: {
            owner,
            token: crypto.randomBytes(8).toString('hex'),
            prevToken: null,
            generatedAt: now,
            leaseUntil,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return { token: doc.token, leaseUntil: doc.leaseUntil, slot };
    } catch (err) {
      // Slot taken between the filter and the insert, or held by a live lease so
      // the filter never matched and the upsert became an insert. Either way the
      // slot is not ours — try the next one.
      if (err && (err.code === 11000 || err.code === 11001)) continue;
      throw err;
    }
  }
  return null;
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

/** Bulk-removes every expired-lease seeder row across all sessions — the background sweep. */
async function removeExpiredSeedTokens(now = Date.now()) {
  return getModel().deleteMany({ role: 'seed', leaseUntil: { $ne: null, $lte: now } });
}

module.exports = {
  ROTATION_MS,
  GRACE_MS,
  getToken,
  verifyToken,
  removeToken,
  claimSeedSlot,
  getSeedToken,
  removeSeedToken,
  removeExpiredSeedTokens,
};
