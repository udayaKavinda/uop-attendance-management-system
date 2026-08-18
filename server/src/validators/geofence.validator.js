function validatePolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return { ok: false, status: 400, error: 'polygon must have at least 3 [lng, lat] vertices' };
  }
  const clean = [];
  for (const pt of polygon) {
    if (!Array.isArray(pt) || pt.length !== 2) {
      return { ok: false, status: 400, error: 'Each polygon vertex must be [lng, lat]' };
    }
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return { ok: false, status: 400, error: 'Invalid [lng, lat] vertex' };
    }
    clean.push([lng, lat]);
  }
  return { ok: true, polygon: clean };
}

function validateGeofenceCreateBody(body) {
  const { name, polygon } = body || {};
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return { ok: false, status: 400, error: 'name is required' };
  const check = validatePolygon(polygon);
  if (!check.ok) return check;
  return { ok: true, name: trimmedName, polygon: check.polygon };
}

/** Body for PATCH — every field independently optional, at least one required. */
function validateGeofenceUpdateBody(body) {
  const b = body || {};
  const result = {};

  if ('name' in b) {
    const trimmedName = String(b.name || '').trim();
    if (!trimmedName) return { ok: false, status: 400, error: 'name must not be empty' };
    result.name = trimmedName;
  }
  if ('polygon' in b) {
    const check = validatePolygon(b.polygon);
    if (!check.ok) return check;
    result.polygon = check.polygon;
  }
  if ('active' in b) {
    if (typeof b.active !== 'boolean') return { ok: false, status: 400, error: 'active must be a boolean' };
    result.active = b.active;
  }
  if (Object.keys(result).length === 0) {
    return { ok: false, status: 400, error: 'No recognized fields in body' };
  }
  return { ok: true, ...result };
}

module.exports = { validateGeofenceCreateBody, validateGeofenceUpdateBody };
