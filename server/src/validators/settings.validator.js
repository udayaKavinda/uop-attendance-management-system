/**
 * Body for PATCH /api/admin/settings. Every field is independently optional —
 * only recognized ones are applied. At least one must be present.
 */
function validateSettingsBody(body) {
  const b = body || {};
  const result = {};

  for (const flag of ['bleEnabled', 'suspiciousBandAutoPass']) {
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
