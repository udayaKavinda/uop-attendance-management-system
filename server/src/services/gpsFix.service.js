const { distanceToNearestGeofenceMeters } = require('../utils/geo');
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
 * anything — weighting, banding — is still pure and still synchronous, so the
 * arithmetic remains testable without a database.
 */

const FIX_WINDOW_MS = 90_000; // matches the client's 90s runtime window

/**
 * Default sample size, and the floor every multi-point strategy keeps.
 *
 * No longer the only answer: each strategy declares its own minimum and an admin
 * can raise it per strategy (`Settings.minFixesByStrategy`), because the
 * strategies stop being distinguishable from one another at a sample of one —
 * see geofenceLogic.service.js. This constant is what they resolve to when
 * nothing is configured.
 */
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

/** A fix's arrival time, or 0 for a fix built by hand in a test. */
function timestampOf(fix) {
  const raw = Number(fix?.ts);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * The single most precise fix in a sample — what `best_accuracy_fix` is entirely
 * built on — chosen so that the answer depends on the sample's *contents* and
 * never on the order they happen to sit in.
 *
 * Three rules, applied in order:
 *
 *  1. Smallest `normalizedAccuracy`, not the raw field. An accuracy-unknown fix
 *     reports 0, and 0 means "no accuracy information", not "perfect" — without
 *     normalizing, such a fix wins "most precise" and then decides the whole
 *     verdict on its own.
 *  2. On a tie, the **newest** reading wins, matching how the rest of the attempt
 *     treats fresher evidence (attemptVerdict.record overwrites for the same
 *     reason).
 *  3. Still tied — same accuracy, same millisecond — the **farther** reading
 *     wins.
 *
 * Rules 2 and 3 are the part that was missing, and it mattered. Phones quantize
 * accuracy (5, 10, 20 m are all common repeated values), so ties are ordinary
 * rather than rare, and a plain `<` reduce silently kept whichever tied fix the
 * array held first. Measured: four fixes all at accuracy 5, two inside the
 * polygon and two ~503 m out, banded `inside` when the inside pair came first and
 * `far` when it came second — the same evidence, two opposite verdicts, decided
 * by nothing.
 *
 * Rule 3 needs a justification rather than just a coin-toss, because at that
 * point the sample is genuinely self-contradictory: two readings, equally
 * precise, equally fresh, in different places, and nothing left to separate them
 * on. Taking the farther one declines to grant a pass on evidence that cannot
 * support it — and the student is not stranded, because `far`/`suspicious` write
 * nothing and the lecturer's code is still there. It also keeps the choice
 * meaningful; ordering on coordinates would be just as deterministic and say
 * nothing at all.
 *
 * @param {Array} fixes non-empty
 * @param {number[]} distances distance of `fixes[i]`, same order — already
 *   computed by the caller, so rule 3 costs nothing.
 */
function mostPreciseFix(fixes, distances) {
  let bestIndex = 0;
  for (let i = 1; i < fixes.length; i += 1) {
    const accuracy = normalizedAccuracy(fixes[i]);
    const bestAccuracy = normalizedAccuracy(fixes[bestIndex]);
    if (accuracy > bestAccuracy) continue;
    if (accuracy < bestAccuracy) {
      bestIndex = i;
      continue;
    }
    const ts = timestampOf(fixes[i]);
    const bestTs = timestampOf(fixes[bestIndex]);
    if (ts < bestTs) continue;
    if (ts > bestTs) {
      bestIndex = i;
      continue;
    }
    if (distanceAt(distances, i) > distanceAt(distances, bestIndex)) bestIndex = i;
  }
  return fixes[bestIndex];
}

/** A fix's precomputed distance, or -Infinity when the caller supplied none. */
function distanceAt(distances, index) {
  const raw = Array.isArray(distances) ? Number(distances[index]) : NaN;
  return Number.isFinite(raw) ? raw : -Infinity;
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
 * The sample a strategy gets to decide on: every live fix, once there are enough
 * of them. Returns null below the minimum, which reads as "no verdict yet, keep
 * collecting" — the client streams for the full 90 s, so more fixes are coming.
 *
 * ## There used to be an outlier trimmer here, and it was removed
 *
 * It dropped any fix further from the marginal median than `max(15, 2 × median
 * distance)`, before any strategy ran. It was added for a real incident (three
 * in-room fixes plus one glitch banding a student `far` at 86 km) but it was
 * doing consensus filtering underneath rules that are not all consensus rules,
 * and it produced two measured wrongs of its own:
 *
 *  - `any_point_within` promises "pass as soon as a single collected fix lands
 *    inside the buffer". With readings scattered 55-106 m out plus one dead
 *    inside the polygon, the inside fix was the outlier and was discarded — so
 *    the strategy reported 55 m and refused the pass its own description
 *    guarantees. `best_accuracy_fix` was worse than merely wrong: its entire
 *    premise is to trust the accuracy field and ignore the rest, and the trimmer
 *    overruled it on position agreement.
 *  - Trimming ran BEFORE accuracy weighting, and judged only position. Four
 *    identical 100 m-accuracy readings outvoted one 5 m reading and threw it
 *    away, so the centroid reported 111 m when the one trustworthy fix was
 *    inside the building. The 1/accuracy² weighting exists precisely to let a
 *    5 m fix dominate a 100 m fix 400:1 and never got to run. That is not
 *    hypothetical: a coarse network fix repeats the same coordinate, which is
 *    what a phone reports indoors before it gets a satellite lock, so the bad
 *    cluster agreeing with itself is the normal case rather than the odd one.
 *
 * Outlier resistance is now a *strategy choice* rather than a hidden pre-filter:
 * `median_distance` and `majority_points_within` are inherently robust to a
 * stray reading, and an admin who wants that picks one. The cost of removing it
 * is that `accuracy_weighted_centroid` is again exposed to a glitch that also
 * reports good accuracy — documented under "Known limits" in
 * docs/attendance-verification-design.md rather than papered over here.
 */
function sampleForVerdict(fixes, minFixes = MIN_FIXES) {
  if (fixes.length < minFixes) return null;
  return fixes;
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
  const survivors = sampleForVerdict(liveFixes(doc?.fixes));
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
/**
 * One band's verdict against its own strategy and its own sample size.
 *
 * Each band measures independently because the two may need different numbers
 * of fixes: near and far pick strategies separately, and a strategy's minimum
 * travels with it. Recomputing the metrics per band is pure arithmetic
 * over at most `MAX_BUFFERED_FIXES` points, so the duplication costs nothing
 * worth sharing state to avoid.
 *
 * `ready: false` means this band cannot answer yet — not that it failed.
 */
function evaluateBand(fixes, polygons, strategyId, bufferM, configuredMinFixes) {
  const minFixes = geofenceLogicService.minFixesFor(strategyId, configuredMinFixes);
  const survivors = sampleForVerdict(fixes, minFixes);
  if (!survivors) return { ready: false };

  const centroid = { ...accuracyWeightedCentroid(survivors), fixCount: survivors.length };
  const fixDistances = survivors.map((f) => distanceToNearestGeofenceMeters(f.lat, f.lng, polygons));
  const centroidDistanceM = distanceToNearestGeofenceMeters(centroid.lat, centroid.lng, polygons);
  const bestFix = mostPreciseFix(survivors, fixDistances);
  const bestAccuracyFixDistanceM = distanceToNearestGeofenceMeters(
    bestFix.lat, bestFix.lng, polygons,
  );
  const metrics = { fixDistances, centroidDistanceM, bestAccuracyFixDistanceM };

  const result = geofenceLogicService.evaluate(strategyId, metrics, bufferM);
  return { ready: true, centroid, ...result };
}

async function evaluateFix(studentId, sessionId, fix, geofences, buffers) {
  const fixes = await addFix(studentId, sessionId, fix);
  const polygons = geofences.map((g) => g.polygon);
  const { minFixesByStrategy } = buffers;

  // Near is always asked first and must be READY before anything is decided,
  // even when it is the band that needs the larger sample. Banding `suspicious`
  // off a ready far-check while near still had too few fixes would hand the
  // student the weaker of two verdicts they might have earned — and the two are
  // not interchangeable: `near` passes on GPS alone, `suspicious` only ever
  // passes via the lecturer's code.
  const near = evaluateBand(
    fixes, polygons, buffers.nearBufferLogic, buffers.nearBufferM, minFixesByStrategy,
  );
  if (!near.ready) return { ready: false, band: null, centroid: null };
  if (near.withinBuffer) {
    return {
      ready: true,
      band: near.distanceM === 0 ? 'inside' : 'near',
      centroid: near.centroid,
      distanceM: near.distanceM,
    };
  }

  // Not near. Telling `suspicious` from `far` decides whether a correct code
  // marks the student present or flags them, so the far strategy gets its own
  // sample requirement too and we keep collecting until it can answer.
  const far = evaluateBand(
    fixes, polygons, buffers.farBufferLogic, buffers.farBufferM, minFixesByStrategy,
  );
  if (!far.ready) return { ready: false, band: null, centroid: null };
  return {
    ready: true,
    band: far.withinBuffer ? 'suspicious' : 'far',
    centroid: far.centroid,
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
  sampleForVerdict,
  mostPreciseFix,
  accuracyWeightedCentroid,
  computeCentroid,
  isPassBand,
  evaluateBand,
  evaluateFix,
};
