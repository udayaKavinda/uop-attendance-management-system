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
 * Whether a session may be created/kept with the given `verification` value under
 * the current global `allowedModes`. `both` permits any per-session choice; a
 * single-mode policy forces sessions to that exact mode.
 */
function isVerificationAllowed(allowedModes, verification) {
  if (allowedModes === 'both') return true;
  return allowedModes === verification;
}

module.exports = { getSettings, updateSettings, isManualCodeAllowed, isVerificationAllowed };
