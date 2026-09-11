const { distanceToNearestGeofenceMeters, haversineMeters } = require('../utils/geo');
const geofenceLogicService = require('./geofenceLogic.service');
const AttendanceAttempt = require('../models/AttendanceAttempt');
// One-way: attemptVerdict does not require this module, so there is no cycle.
const { VERDICT_TTL_MS } = require('./attemptVerdict.service');

/**
 * The GPS half of an attendance attempt, held in MongoDB alongside the verdict
 * it produces (see AttendanceAttempt, and attemptVerdict.service for the other
 * half of the same document).
 *
 * This was a per-process `Map`. The storage moved because that made a restart
 * mid-lecture lose every in-flight attempt and made a second app instance
 * impossible. Only the storage moved: every function below that decides
 * anything — trimming, weighting, banding — is still pure and still
 * synchronous, so the arithmetic remains testable without a database.
 */

const FIX_WINDOW_MS = 90_000; // matches the client's 90s runtime window
const MIN_FIXES = 3;

/**
 * Hard cap on stored fixes per attempt. The client sends one roughly every 3
 * seconds, so a well-behaved 90-second window contributes about 30; this leaves
 * generous headroom while keeping a single document bounded no matter how fast
 * a client decides to talk.
 */
const MAX_BUFFERED_FIXES = 120;

/**
 * Android's `Location.getAccuracy()` returns 0.0 when `hasAccuracy()` is false,
 * i.e. 0 means "no accuracy information", NOT "perfect fix". Treat it (and any
 * other non-positive/garbage value) as this pessimistic default everywhere, so
 * weighting and best-fix selection agree. They did not before: the weighting
 * used `Number(accuracy) || 50` (which quietly mapped 0 → 50) while best-fix
 * selection compared the raw value, so an accuracy-unknown fix was
 * simultaneously the least-trusted for the centroid and "the most precise fix
 * we have" for the `best_accuracy_fix` strategy.
 */
const UNKNOWN_ACCURACY_M = 50;

function normalizedAccuracy(fix) {
  const raw = Number(fix?.accuracy);
  if (!Number.isFinite(raw) || raw <= 0) return UNKNOWN_ACCURACY_M;
  return Math.max(1, raw);
}

/** Drops anything outside the live window. Pure — the age rule, in one place. */
function liveFixes(fixes, now = Date.now()) {
  return (fixes || []).filter((f) => now - f.ts <= FIX_WINDOW_MS);
}

/**
 * Appends a fix and returns the live buffer for this attempt.
 *
 * One round trip, and `$push` is atomic: two fixes arriving together from the
 * same device both land, where the previous read-modify-write on a `Map` could
 * drop one. Ageing is applied to the returned array rather than by rewriting
 * the document, so a write never has to read first.
 */
async function addFix(studentId, sessionId, fix) {
  const now = Date.now();
  const doc = await AttendanceAttempt.findOneAndUpdate(
    { student: String(studentId), session: String(sessionId) },
    {
      $push: {
        fixes: {
          $each: [{
            lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ts: now,
          }],
          $slice: -MAX_BUFFERED_FIXES,
        },
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return liveFixes(doc.fixes, now);
}

/**
 * Drops the fixes but keeps the document, because the verdict they produced
 * lives in it and outlives them. The attempt itself is ended by
 * attemptVerdict.clear, which every call site pairs with this one.
 */
async function clearFixes(studentId, sessionId) {
  await AttendanceAttempt.updateOne(
    { student: String(studentId), session: String(sessionId) },
    { $set: { fixes: [] } },
  );
}

/**
 * Deletes buffers with nothing live left in them.
 *
 * Abandoned attempts are the common case, not the exception — location denied,
 * student out of range, app closed, walked away mid-scan — and `clearFixes`
 * only runs on a pass, so without this they accumulate for a whole semester.
 * The TTL index on the collection is the routine cleanup; this exists so the
 * sweep can also be driven explicitly, and asserted on, rather than waiting on
 * MongoDB's periodic monitor.
 *
 * Cannot change a verdict, only storage: a buffer in this state holds only
 * fixes that `liveFixes` would discard anyway.
 */
async function sweep(now = Date.now(), verdictTtlMs = VERDICT_TTL_MS) {
  const fixCutoff = now - FIX_WINDOW_MS;
  const verdictCutoff = now - verdictTtlMs;
  const res = await AttendanceAttempt.deleteMany({
    // No live fix left ...
    $nor: [{ fixes: { $elemMatch: { ts: { $gt: fixCutoff } } } }],
    // ... AND no verdict still worth judging a code submission against. Both
    // halves are required: deleting on stale fixes alone would throw away the
    // verdict a student is on their way to the front of the hall to use, which
    // is the exact failure this state was made durable to prevent.
    $or: [{ verdictTs: null }, { verdictTs: { $lte: verdictCutoff } }],
  });
  return res.deletedCount || 0;
}

/**
 * Step 1: require >= MIN_FIXES fixes, then drop fixes whose distance from the median
 * location exceeds ~2x the median distance (with a floor so a tight, low-noise
 * cluster doesn't over-trim on tiny jitter).
 *
 * Returns null both when there aren't enough fixes yet AND when trimming leaves
 * fewer than MIN_FIXES trustworthy ones — in either case the honest answer is
 * "no verdict yet, keep collecting", and the client streams for the full 90 s so
 * more fixes are coming. This previously fell back to returning the *untrimmed*
 * list instead, which meant the trimmer identified an outlier and then handed it
 * straight back: a student with 3 perfect in-room fixes plus one glitch (i.e.
 * exactly MIN_FIXES) banded as `far`, measured at 86 km from the building.
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
  return survivors.length >= MIN_FIXES ? survivors : null;
}

/** Step 2: average survivors weighted by 1/accuracy² so precise fixes dominate. */
function accuracyWeightedCentroid(fixes) {
  let sumWeight = 0;
  let sumLat = 0;
  let sumLng = 0;
  let bestAccuracy = Infinity;
  for (const f of fixes) {
    const accuracy = normalizedAccuracy(f);
    const weight = 1 / (accuracy * accuracy);
    sumWeight += weight;
    sumLat += f.lat * weight;
    sumLng += f.lng * weight;
    bestAccuracy = Math.min(bestAccuracy, accuracy);
  }
  return { lat: sumLat / sumWeight, lng: sumLng / sumWeight, bestAccuracy };
}

/** Returns null if there aren't enough fixes yet to decide. */
async function computeCentroid(studentId, sessionId) {
  const doc = await AttendanceAttempt.findOne({
    student: String(studentId), session: String(sessionId),
  });
  const survivors = removeOutliersByMedianDistance(liveFixes(doc?.fixes));
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
async function evaluateFix(studentId, sessionId, fix, geofences, buffers) {
  const fixes = await addFix(studentId, sessionId, fix);
  const survivors = removeOutliersByMedianDistance(fixes);
  if (!survivors) return { ready: false, band: null, centroid: null };

  const centroid = { ...accuracyWeightedCentroid(survivors), fixCount: survivors.length };

  const polygons = geofences.map((g) => g.polygon);
  const fixDistances = survivors.map((f) => distanceToNearestGeofenceMeters(f.lat, f.lng, polygons));
  const centroidDistanceM = distanceToNearestGeofenceMeters(centroid.lat, centroid.lng, polygons);
  // normalizedAccuracy, not the raw field: an accuracy-unknown (0) fix must not
  // win "most precise" and then dominate the whole verdict under best_accuracy_fix.
  const bestAccuracyFix = survivors.reduce(
    (best, f) => (normalizedAccuracy(f) < normalizedAccuracy(best) ? f : best),
  );
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
  MAX_BUFFERED_FIXES,
  addFix,
  clearFixes,
  sweep,
  liveFixes,
  removeOutliersByMedianDistance,
  accuracyWeightedCentroid,
  computeCentroid,
  isPassBand,
  evaluateFix,
};
