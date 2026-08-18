const Settings = require('../models/Settings');

// Short cache: settings are read on every manual-code status/attendance check, so
// avoid a DB round-trip per request while still picking up admin changes quickly.
const CACHE_TTL_MS = 5000;
let _cache = null; // { value, ts }

/** Reads the singleton, creating it with defaults on first call (atomic upsert). */
async function getSettings() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.value;
  const doc = await Settings.findOneAndUpdate(
    {},
    { $setOnInsert: { manualCodeAllowed: true } },
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

async function isManualCodeAllowed() {
  const settings = await getSettings();
  return settings.manualCodeAllowed !== false;
}

/**
 * Whether a session may use the given `verification` value under the admin's
 * per-policy global switches. `both` needs both policies on, since it can accept
 * a student through either one.
 */
function isVerificationAllowed(settings, verification) {
  const bluetooth = settings.bluetoothAllowed !== false;
  const geofence = settings.geofenceAllowed === true;
  if (verification === 'bluetooth') return bluetooth;
  if (verification === 'geofence') return geofence;
  if (verification === 'both') return bluetooth && geofence;
  return false;
}

/** The verification values a lecturer may currently pick, in strictness order. */
function allowedVerifications(settings) {
  return ['bluetooth', 'geofence', 'both'].filter((v) => isVerificationAllowed(settings, v));
}

module.exports = {
  getSettings, updateSettings, isManualCodeAllowed, isVerificationAllowed, allowedVerifications,
};
