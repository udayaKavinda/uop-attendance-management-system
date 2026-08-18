/** Pure geodesy helpers for geofence validation. No DB/state — see services/gpsFix.service.js for that. */

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two [lat, lng] points, in meters. */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Projects a [lng, lat] point to local meters (equirectangular approximation)
 * around a reference point. Accurate to well under a meter of error at
 * building/room scale (tens of meters); not meant for anything larger.
 */
function toLocalMeters(lng, lat, refLng, refLat) {
  const x = toRad(lng - refLng) * EARTH_RADIUS_M * Math.cos(toRad(refLat));
  const y = toRad(lat - refLat) * EARTH_RADIUS_M;
  return [x, y];
}

/** Ray-casting point-in-polygon test. `point` and `polygon` are in the same (planar) coordinate space. */
function isPointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distanceToPolygonBoundary(point, polygon) {
  const [px, py] = point;
  let min = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    min = Math.min(min, distanceToSegment(px, py, xj, yj, xi, yi));
  }
  return min;
}

/**
 * Accept if `[lat, lng]` is inside `polygon` ([[lng, lat], ...]), or within
 * `bufferMeters` of its boundary. Buffering-by-distance-to-boundary rather than
 * literally inflating the polygon is a standard, much simpler equivalent at this
 * scale, and avoids the edge cases of offsetting concave polygons.
 */
function isWithinGeofence(lat, lng, polygon, bufferMeters) {
  const [refLng, refLat] = polygon[0];
  const localPolygon = polygon.map(([plng, plat]) => toLocalMeters(plng, plat, refLng, refLat));
  const localPoint = toLocalMeters(lng, lat, refLng, refLat);
  if (isPointInPolygon(localPoint, localPolygon)) return true;
  return distanceToPolygonBoundary(localPoint, localPolygon) <= bufferMeters;
}

module.exports = {
  haversineMeters,
  toLocalMeters,
  isPointInPolygon,
  distanceToPolygonBoundary,
  isWithinGeofence,
};
