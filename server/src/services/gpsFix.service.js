const { haversineMeters, isWithinGeofence } = require('../utils/geo');

/**
 * Per-(student, session) GPS fix accumulator, transient — matches the design's
 * "in-memory Map for a single process" caveat shared with the OAuth code store
 * and the sign-in nonce store; move to Redis before scaling out.
 */
const fixBuffers = new Map(); // key -> [{ lat, lng, accuracy, ts }]

const FIX_WINDOW_MS = 90_000; // matches the client's 90s runtime window
const MIN_FIXES = 4;

function fixKey(studentId, sessionId) {
  return `${studentId}:${sessionId}`;
}

/** Appends a fix, dropping anything older than the 90s window, and returns the live buffer. */
function addFix(studentId, sessionId, fix) {
  const key = fixKey(studentId, sessionId);
  const now = Date.now();
  const existing = fixBuffers.get(key) || [];
  const fresh = existing.filter((f) => now - f.ts <= FIX_WINDOW_MS);
  fresh.push({
    lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ts: now,
  });
  fixBuffers.set(key, fresh);
  return fresh;
}

function clearFixes(studentId, sessionId) {
  fixBuffers.delete(fixKey(studentId, sessionId));
}

/**
 * Step 1 of the design's algorithm: require >= 4 fixes, then drop fixes whose
 * distance from the median location exceeds ~2x the median distance (with a
 * floor so a tight, low-noise cluster doesn't over-trim on tiny jitter).
 */
function removeOutliersByMedianDistance(fixes) {
  if (fixes.length < MIN_FIXES) return null;

  const lats = [...fixes.map((f) => f.lat)].sort((a, b) => a - b);
  const lngs = [...fixes.map((f) => f.lng)].sort((a, b) => a - b);
  const mid = Math.floor(fixes.length / 2);
  const medianLat = fixes.length % 2 ? lats[mid] : (lats[mid - 1] + lats[mid]) / 2;
  const medianLng = fixes.length % 2 ? lngs[mid] : (lngs[mid - 1] + lngs[mid]) / 2;

  const distances = fixes.map((f) => haversineMeters(f.lat, f.lng, medianLat, medianLng));
  const sortedDist = [...distances].sort((a, b) => a - b);
  const distMid = Math.floor(sortedDist.length / 2);
  const medianDist = sortedDist.length % 2
    ? sortedDist[distMid]
    : (sortedDist[distMid - 1] + sortedDist[distMid]) / 2;
  const threshold = Math.max(15, medianDist * 2);

  const survivors = fixes.filter((_, idx) => distances[idx] <= threshold);
  return survivors.length >= MIN_FIXES ? survivors : fixes;
}

/** Step 2: average survivors weighted by 1/accuracy² so precise fixes dominate. */
function accuracyWeightedCentroid(fixes) {
  let sumWeight = 0;
  let sumLat = 0;
  let sumLng = 0;
  for (const f of fixes) {
    const accuracy = Math.max(1, Number(f.accuracy) || 50);
    const weight = 1 / (accuracy * accuracy);
    sumWeight += weight;
    sumLat += f.lat * weight;
    sumLng += f.lng * weight;
  }
  return { lat: sumLat / sumWeight, lng: sumLng / sumWeight };
}

/** Returns null if there aren't enough fixes yet to decide. */
function computeCentroid(studentId, sessionId) {
  const fixes = fixBuffers.get(fixKey(studentId, sessionId)) || [];
  const survivors = removeOutliersByMedianDistance(fixes);
  if (!survivors) return null;
  const centroid = accuracyWeightedCentroid(survivors);
  return { ...centroid, fixCount: survivors.length };
}

/**
 * Appends the new fix, recomputes the centroid, and tests it against every
 * still-live building attached to the session. Returns `{ accepted, centroid }`
 * — `centroid` is null while still waiting on more fixes (< 4).
 */
function evaluateFix(studentId, sessionId, fix, geofences, bufferMeters) {
  addFix(studentId, sessionId, fix);
  const centroid = computeCentroid(studentId, sessionId);
  if (!centroid) return { accepted: false, centroid: null };

  const accepted = geofences.some(
    (g) => isWithinGeofence(centroid.lat, centroid.lng, g.polygon, bufferMeters),
  );
  return { accepted, centroid };
}

module.exports = {
  FIX_WINDOW_MS,
  MIN_FIXES,
  addFix,
  clearFixes,
  removeOutliersByMedianDistance,
  accuracyWeightedCentroid,
  computeCentroid,
  evaluateFix,
};
