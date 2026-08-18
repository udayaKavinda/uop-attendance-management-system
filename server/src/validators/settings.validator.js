/**
 * Body for PATCH /api/admin/settings. Every field is independently optional —
 * only recognized ones are applied. At least one must be present.
 */
function validateSettingsBody(body) {
  const b = body || {};
  const result = {};

  for (const flag of ['manualCodeAllowed', 'bluetoothAllowed', 'geofenceAllowed']) {
    if (flag in b) {
      if (typeof b[flag] !== 'boolean') {
        return { ok: false, status: 400, error: `${flag} must be a boolean` };
      }
      result[flag] = b[flag];
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

  if ('bufferGpsOnly' in b) {
    const bufferGpsOnly = Number(b.bufferGpsOnly);
    if (!Number.isFinite(bufferGpsOnly) || bufferGpsOnly < 0 || bufferGpsOnly > 1000) {
      return { ok: false, status: 400, error: 'bufferGpsOnly must be between 0 and 1000 (meters)' };
    }
    result.bufferGpsOnly = bufferGpsOnly;
  }

  if ('bufferGpsBle' in b) {
    const bufferGpsBle = Number(b.bufferGpsBle);
    if (!Number.isFinite(bufferGpsBle) || bufferGpsBle < 0 || bufferGpsBle > 1000) {
      return { ok: false, status: 400, error: 'bufferGpsBle must be between 0 and 1000 (meters)' };
    }
    result.bufferGpsBle = bufferGpsBle;
  }

  if (Object.keys(result).length === 0) {
    return { ok: false, status: 400, error: 'No recognized settings fields in body' };
  }
  return { ok: true, ...result };
}

module.exports = { validateSettingsBody };
