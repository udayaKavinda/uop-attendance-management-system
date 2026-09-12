const { STRATEGIES, MAX_MIN_FIXES } = require('../services/geofenceLogic.service');

const STRATEGY_IDS = new Set(STRATEGIES.map((s) => s.id));
const STRATEGY_BY_ID = new Map(STRATEGIES.map((s) => [s.id, s]));

/**
 * Body for PATCH /api/admin/settings. Every field is independently optional —
 * only recognized ones are applied. At least one must be present.
 */
function validateSettingsBody(body) {
  const b = body || {};
  const result = {};

  for (const flag of ['bleEnabled', 'webAllowNonIos']) {
    if (flag in b) {
      if (typeof b[flag] !== 'boolean') {
        return { ok: false, status: 400, error: `${flag} must be a boolean` };
      }
      result[flag] = b[flag];
    }
  }

  for (const meters of ['nearBufferM', 'farBufferM']) {
    if (meters in b) {
      const value = Number(b[meters]);
      if (!Number.isFinite(value) || value < 0 || value > 5000) {
        return { ok: false, status: 400, error: `${meters} must be between 0 and 5000 (meters)` };
      }
      result[meters] = Math.round(value);
    }
  }

  for (const logic of ['nearBufferLogic', 'farBufferLogic']) {
    if (logic in b) {
      if (!STRATEGY_IDS.has(b[logic])) {
        return { ok: false, status: 400, error: `${logic} must be one of: ${[...STRATEGY_IDS].join(', ')}` };
      }
      result[logic] = b[logic];
    }
  }

  /**
   * A partial map: only the strategies named are changed, and the rest keep
   * whatever they had. A merge rather than a replace because the dashboard edits
   * one strategy at a time, and a replacing PATCH would silently reset every
   * other strategy to its default on each save.
   *
   * Rejects rather than clamps. The read path clamps, because it must always
   * produce a number mid-lecture, but an admin typing 1 against
   * `all_points_within` has asked for something that would turn the strictest
   * strategy into the loosest, and telling them so is better than quietly
   * storing 3.
   */
  if ('minFixesByStrategy' in b) {
    const raw = b.minFixesByStrategy;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, error: 'minFixesByStrategy must be an object keyed by strategy id' };
    }
    const entries = Object.entries(raw);
    if (entries.length === 0) {
      return { ok: false, status: 400, error: 'minFixesByStrategy must name at least one strategy' };
    }
    const merged = {};
    for (const [id, value] of entries) {
      const strategy = STRATEGY_BY_ID.get(id);
      if (!strategy) {
        return { ok: false, status: 400, error: `Unknown geofence logic id: ${id}` };
      }
      // Strict: `Number(value)` would accept "3" and, worse, `true` as 1. This is
      // the write path, so a client sending the wrong type should hear about it
      // rather than have it coerced into a policy change.
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { ok: false, status: 400, error: `minFixesByStrategy.${id} must be a whole number` };
      }
      const n = value;
      if (n < strategy.floorMinFixes || n > MAX_MIN_FIXES) {
        return {
          ok: false,
          status: 400,
          error: `"${strategy.label}" needs between ${strategy.floorMinFixes} and ${MAX_MIN_FIXES} fixes`
            + (strategy.floorMinFixes > 1
              ? ' — below that it stops being distinguishable from the other strategies.'
              : '.'),
        };
      }
      merged[id] = n;
    }
    result.minFixesByStrategy = merged;
  }

  if ('seedRate' in b) {
    const seedRate = Number(b.seedRate);
    if (!Number.isFinite(seedRate) || seedRate < 0 || !Number.isInteger(seedRate)) {
      return { ok: false, status: 400, error: 'seedRate must be a non-negative integer' };
    }
    result.seedRate = seedRate;
  }

  if ('seedWindowMs' in b) {
    const seedWindowMs = Number(b.seedWindowMs);
    if (!Number.isFinite(seedWindowMs) || seedWindowMs < 10_000 || seedWindowMs > 600_000) {
      return { ok: false, status: 400, error: 'seedWindowMs must be between 10000 and 600000' };
    }
    result.seedWindowMs = Math.round(seedWindowMs);
  }

  if ('studentEmailDomain' in b) {
    const domain = String(b.studentEmailDomain || '').trim().toLowerCase();
    if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return { ok: false, status: 400, error: 'studentEmailDomain must be a valid domain, or empty to disable' };
    }
    result.studentEmailDomain = domain;
  }

  if ('minSupportedVersionCode' in b) {
    const versionCode = Number(b.minSupportedVersionCode);
    if (!Number.isInteger(versionCode) || versionCode < 0) {
      return { ok: false, status: 400, error: 'minSupportedVersionCode must be a non-negative integer' };
    }
    result.minSupportedVersionCode = versionCode;
  }

  if (Object.keys(result).length === 0) {
    return { ok: false, status: 400, error: 'No recognized settings fields in body' };
  }
  return { ok: true, ...result };
}

/**
 * Cross-field rule, applied against the settings that WILL be stored (current
 * merged with the patch): an inverted pair would make the suspicious band empty
 * and silently change what a correct code grants.
 */
function checkBufferOrder(current, patch) {
  const near = 'nearBufferM' in patch ? patch.nearBufferM : current.nearBufferM;
  const far = 'farBufferM' in patch ? patch.farBufferM : current.farBufferM;
  if (Number(far) < Number(near)) {
    return { ok: false, status: 400, error: 'farBufferM must be greater than or equal to nearBufferM' };
  }
  return { ok: true };
}

module.exports = { validateSettingsBody, checkBufferOrder };
