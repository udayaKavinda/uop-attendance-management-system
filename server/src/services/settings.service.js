const Settings = require('../models/Settings');
const { DEFAULT_STRATEGY_ID } = require('./geofenceLogic.service');

// Short cache: settings are read on every attendance submission and code status
// check, so avoid a DB round-trip per request while still picking up admin
// changes quickly.
const CACHE_TTL_MS = 5000;
let _cache = null; // { value, ts }

/**
 * Reads the singleton, creating it with defaults the first time.
 *
 * The read is a real read. This used to be a bare `findOneAndUpdate` with
 * `$setOnInsert`, which looks read-only but is not: an upsert is an *update*,
 * and Mongoose stamps `updatedAt` on every update — so each cache miss wrote to
 * the document it was only supposed to look at. Settings are consulted on every
 * attendance submission and every code poll, so a lecture in progress rewrote
 * this singleton every 5 seconds for its whole duration, and `updatedAt` meant
 * "when someone last read the settings" rather than "when an admin last changed
 * them", which is the only question anyone asks of it.
 *
 * The upsert is kept for the one case that needs it — the document genuinely
 * missing — where it is still atomic, so two workers racing on a fresh database
 * cannot create two singletons.
 */
async function getSettings() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.value;
  const doc = await Settings.findOne({}) || await Settings.findOneAndUpdate(
    {},
    { $setOnInsert: { bleEnabled: true } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  _cache = { value: doc, ts: Date.now() };
  return doc;
}

async function updateSettings(patch) {
  const doc = await Settings.findOneAndUpdate(
    {},
    { $set: patch },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  _cache = { value: doc, ts: Date.now() };
  return doc;
}

/** Global Bluetooth kill switch. GPS has no equivalent — every session needs it. */
async function isBleEnabled() {
  const settings = await getSettings();
  return settings.bleEnabled !== false;
}

/**
 * The two distance thresholds (normalized so `near` can never exceed `far`),
 * each band's selected geofence-logic strategy id, and the admin's per-strategy
 * sample requirements.
 *
 * `minFixesByStrategy` is passed through raw rather than resolved here: the
 * resolution needs the strategy id, and which strategy applies is decided
 * per-band inside `gpsFix.evaluateBand`. Resolving eagerly would mean picking a
 * strategy in the wrong place.
 */
function buffers(settings) {
  const nearBufferM = Number.isFinite(settings.nearBufferM) ? settings.nearBufferM : 50;
  const farBufferM = Number.isFinite(settings.farBufferM) ? settings.farBufferM : 100;
  return {
    nearBufferM,
    farBufferM: Math.max(nearBufferM, farBufferM),
    nearBufferLogic: settings.nearBufferLogic || DEFAULT_STRATEGY_ID,
    farBufferLogic: settings.farBufferLogic || DEFAULT_STRATEGY_ID,
    minFixesByStrategy: settings.minFixesByStrategy || null,
  };
}

module.exports = {
  getSettings, updateSettings, isBleEnabled, buffers,
};
