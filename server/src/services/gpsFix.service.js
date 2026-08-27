const { distanceToNearestGeofenceMeters, haversineMeters } = require('../utils/geo');
const geofenceLogicService = require('./geofenceLogic.service');

/**
 * Per-(student, session) GPS fix accumulator, transient — matches the design's
 * "in-memory Map for a single process" caveat shared with the OAuth code store
 * and the sign-in nonce store; move to Redis before scaling out.
 */
const fixBuffers = new Map(); // key -> [{ lat, lng, accuracy, ts }]

const FIX_WINDOW_MS = 90_000; // matches the client's 90s runtime window
const MIN_FIXES = 4;
/**
 * If not one contributing fix beat this accuracy, the centroid is too vague to
 * band honestly — a 200m-accurate "fix" sitting 40m from the building says
 * nothing. Such attempts resolve to `unknown`, which is flagged for the
 * lecturer rather than silently passing or silently failing.
 */
const ACCURACY_CEILING_M = 75;

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
 * Step 1: require >= 4 fixes, then drop fixes whose distance from the median
 * location exceeds ~2x the median distance (with a floor so a tight, low-noise
 * cluster doesn't over-trim on tiny jitter).
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
  let bestAccuracy = Infinity;
  for (const f of fixes) {
    const accuracy = Math.max(1, Number(f.accuracy) || 50);
    const weight = 1 / (accuracy * accuracy);
    sumWeight += weight;
    sumLat += f.lat * weight;
    sumLng += f.lng * weight;
    bestAccuracy = Math.min(bestAccuracy, accuracy);
  }
  return { lat: sumLat / sumWeight, lng: sumLng / sumWeight, bestAccuracy };
}

/** Returns null if there aren't enough fixes yet to decide. */
function computeCentroid(studentId, sessionId) {
  const fixes = fixBuffers.get(fixKey(studentId, sessionId)) || [];
  const survivors = removeOutliersByMedianDistance(fixes);
  if (!survivors) return null;
  const centroid = accuracyWeightedCentroid(survivors);
  return { ...centroid, fixCount: survivors.length };
}

// Raw-GPS auto-pass only — `suspicious` deliberately never passes silently on
// GPS alone, only via a correct code (see attendance.service.js's own check in
// recordHelpCodeAttendance, which treats suspicious as passing there).
const PASS_BANDS = new Set(['inside', 'near']);

function isPassBand(band) {
  return PASS_BANDS.has(band);
}

/**
 * Appends the new fix and re-bands the accumulated centroid against every
 * still-live building on the session.
 *
 * `ready: false` means "still collecting, no verdict yet". A ready verdict
 * carries a band but deliberately no pass/fail wording — the caller decides,
 * and the client is never told which band it landed in.
 *
 * The near and far bands are each decided by an independently selectable
 * strategy (`buffers.nearBufferLogic`/`farBufferLogic`, see
 * `geofenceLogic.service.js`) run against the same per-fix distance metrics —
 * near is checked first since it's the stronger claim, then far only if near
 * didn't already pass.
 */
function evaluateFix(studentId, sessionId, fix, geofences, buffers) {
  const fixes = addFix(studentId, sessionId, fix);
  const survivors = removeOutliersByMedianDistance(fixes);
  if (!survivors) return { ready: false, band: null, centroid: null };

  const centroid = { ...accuracyWeightedCentroid(survivors), fixCount: survivors.length };
  if (centroid.bestAccuracy > ACCURACY_CEILING_M) {
    return {
      ready: true, band: 'unknown', centroid, distanceM: null,
    };
  }

  const polygons = geofences.map((g) => g.polygon);
  const fixDistances = survivors.map((f) => distanceToNearestGeofenceMeters(f.lat, f.lng, polygons));
  const centroidDistanceM = distanceToNearestGeofenceMeters(centroid.lat, centroid.lng, polygons);
  const bestAccuracyFix = survivors.reduce((best, f) => (f.accuracy < best.accuracy ? f : best));
  const bestAccuracyFixDistanceM = distanceToNearestGeofenceMeters(
    bestAccuracyFix.lat, bestAccuracyFix.lng, polygons,
  );
  const metrics = { fixDistances, centroidDistanceM, bestAccuracyFixDistanceM };

  const near = geofenceLogicService.evaluate(buffers.nearBufferLogic, metrics, buffers.nearBufferM);
  if (near.withinBuffer) {
    return {
      ready: true,
      band: near.distanceM === 0 ? 'inside' : 'near',
      centroid,
      distanceM: near.distanceM,
    };
  }

  const far = geofenceLogicService.evaluate(buffers.farBufferLogic, metrics, buffers.farBufferM);
  return {
    ready: true,
    band: far.withinBuffer ? 'suspicious' : 'far',
    centroid,
    distanceM: far.distanceM,
  };
}

module.exports = {
  FIX_WINDOW_MS,
  MIN_FIXES,
  ACCURACY_CEILING_M,
  addFix,
  clearFixes,
  removeOutliersByMedianDistance,
  accuracyWeightedCentroid,
  computeCentroid,
  isPassBand,
  evaluateFix,
};
