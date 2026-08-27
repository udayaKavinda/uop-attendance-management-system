const Settings = require('../models/Settings');
const { DEFAULT_STRATEGY_ID } = require('./geofenceLogic.service');

// Short cache: settings are read on every attendance submission and code status
// check, so avoid a DB round-trip per request while still picking up admin
// changes quickly.
const CACHE_TTL_MS = 5000;
let _cache = null; // { value, ts }

/** Reads the singleton, creating it with defaults on first call (atomic upsert). */
async function getSettings() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.value;
  const doc = await Settings.findOneAndUpdate(
    {},
    { $setOnInsert: { bleEnabled: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  _cache = { value: doc, ts: Date.now() };
  return doc;
}

async function updateSettings(patch) {
  const doc = await Settings.findOneAndUpdate(
    {},
    { $set: patch },
    { upsert: true, new: true, setDefaultsOnInsert: true },
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
 * The two distance thresholds (normalized so `near` can never exceed `far`)
 * plus each band's selected geofence-logic strategy id.
 */
function buffers(settings) {
  const nearBufferM = Number.isFinite(settings.nearBufferM) ? settings.nearBufferM : 50;
  const farBufferM = Number.isFinite(settings.farBufferM) ? settings.farBufferM : 100;
  return {
    nearBufferM,
    farBufferM: Math.max(nearBufferM, farBufferM),
    nearBufferLogic: settings.nearBufferLogic || DEFAULT_STRATEGY_ID,
    farBufferLogic: settings.farBufferLogic || DEFAULT_STRATEGY_ID,
  };
}

module.exports = {
  getSettings, updateSettings, isBleEnabled, buffers,
};
