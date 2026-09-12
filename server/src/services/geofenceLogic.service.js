/**
 * Pluggable "is this student within the buffer?" strategies. The near and far
 * bands each pick one independently (`Settings.nearBufferLogic`/`farBufferLogic`),
 * so an admin can e.g. require a majority of fixes inside the near buffer while
 * only needing any single fix inside the far one.
 *
 * Every strategy receives precomputed `metrics` for one verdict attempt (built in
 * `gpsFix.service.js`) and a buffer distance in meters, and returns whether that
 * buffer is satisfied plus a representative distance for reporting/comments.
 *
 * ## How many fixes each one needs
 *
 * A strategy also declares how large a sample it needs before it may decide.
 * That number belongs here, next to the strategy, rather than as one global
 * constant, because the strategies do not all mean the same thing at the same
 * sample size — and at the smallest size they stop meaning anything at all.
 *
 * With a single fix, `fixDistances` has one element, so its minimum, maximum and
 * median are the same number, the accuracy-weighted centroid *is* that fix, and
 * the best-accuracy fix is that fix. Every strategy below returns an identical
 * answer. `all_points_within` — the strictest option, whose own description warns
 * that one stray reading fails the whole attempt — becomes exactly equivalent to
 * `any_point_within`, the loosest. Allowing a floor of 1 for the multi-point
 * strategies would therefore not make them permissive, it would silently turn
 * them into a different strategy, so they floor at 3.
 *
 * At **two** fixes the collapse is only partial but still real: `all_points_within`
 * and `majority_points_within` become the same rule, since "more than half of 2"
 * is 2. So 3 is the smallest sample at which all six are genuinely distinct, and
 * that is where the multi-point floor sits.
 *
 * The two single-fix strategies are different in kind: `any_point_within` and
 * `best_accuracy_fix` both ask a question about one reading, so one reading is a
 * coherent answer and they may floor at 1. They still *default* to 2, and it is
 * worth being straight about how little that buys now that nothing filters the
 * sample: `any_point_within` takes the closest fix and `best_accuracy_fix` the
 * most precise one, so a second reading cannot outvote a bad first one. What it
 * does buy is not forming a whole verdict from the first reading of a cold start,
 * which is routinely the coarsest one a device produces — measured at 100 m
 * accuracy indoors while later fixes improved. It is a settling allowance, not a
 * safety margin, and an admin who wants the fastest possible verdict can set 1.
 *
 * An admin may raise any of these (see `Settings.minFixesByStrategy`); the floors
 * are what stops a setting from changing what a strategy *is*.
 */

/**
 * Ceiling on the admin-configurable minimum.
 *
 * Not arbitrary: fix delivery is the platform's choice, not ours. Measured
 * indoors on an API 31 phone reporting 100 m accuracy, fixes arrived every
 * 20-25 s — about four in the whole 90-second window. A minimum above that is
 * not "strict", it is a band that can never be reached in a bad room, and the
 * student is pushed to the lecturer's code every time with nothing to show why.
 */
const MAX_MIN_FIXES = 10;


function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const STRATEGIES = [
  {
    id: 'accuracy_weighted_centroid',
    defaultMinFixes: 3,
    floorMinFixes: 3,
    label: 'Accuracy-weighted centroid',
    description: 'Average every fix, weighted toward the more precise ones, then check the average position.',
    evaluate(metrics, bufferM) {
      const distanceM = metrics.centroidDistanceM;
      return { withinBuffer: distanceM <= bufferM, distanceM };
    },
  },
  {
    id: 'any_point_within',
    defaultMinFixes: 2,
    floorMinFixes: 1,
    label: 'Any point within geofence',
    description: 'Pass as soon as a single collected fix lands inside the buffer.',
    evaluate(metrics) {
      const distanceM = Math.min(...metrics.fixDistances);
      return { withinBuffer: undefined, distanceM };
    },
  },
  {
    id: 'majority_points_within',
    defaultMinFixes: 3,
    floorMinFixes: 3,
    label: 'Most points within geofence',
    description: 'Pass when more than half of the collected fixes land inside the buffer.',
    evaluate(metrics, bufferM) {
      const within = metrics.fixDistances.filter((d) => d <= bufferM).length;
      return { withinBuffer: within > metrics.fixDistances.length / 2, distanceM: median(metrics.fixDistances) };
    },
  },
  {
    id: 'all_points_within',
    defaultMinFixes: 3,
    floorMinFixes: 3,
    label: 'All points within geofence',
    // Deliberately blunt, and now literally so: nothing filters the sample any
    // more, so a single stray reading out of ~30 really does fail the whole
    // attempt and a student who never left the room can be flagged. Measured:
    // 3 fixes dead inside the polygon plus one 166 m drift bands as `far`.
    // Offered for small, very tight geofences only — `median_distance` is the
    // option to reach for when one bad reading should not decide anything.
    description: 'Strictest option — every collected fix must land inside the buffer. '
      + 'One stray GPS reading fails the whole attempt, so most rooms should not use this.',
    evaluate(metrics) {
      const distanceM = Math.max(...metrics.fixDistances);
      return { withinBuffer: undefined, distanceM };
    },
  },
  {
    id: 'median_distance',
    defaultMinFixes: 3,
    floorMinFixes: 3,
    label: 'Median distance',
    description: 'Check the middle distance across all fixes — robust to a single outlier fix either way.',
    evaluate(metrics) {
      return { withinBuffer: undefined, distanceM: median(metrics.fixDistances) };
    },
  },
  {
    id: 'best_accuracy_fix',
    defaultMinFixes: 2,
    floorMinFixes: 1,
    label: 'Best-accuracy fix only',
    description: "Ignore every fix except the single most precise one the device reported.",
    evaluate(metrics) {
      return { withinBuffer: undefined, distanceM: metrics.bestAccuracyFixDistanceM };
    },
  },
];

const STRATEGY_MAP = new Map(STRATEGIES.map((s) => [s.id, s]));
const DEFAULT_STRATEGY_ID = 'accuracy_weighted_centroid';

/**
 * Runs the named strategy (falling back to the default for an unrecognized id,
 * e.g. one saved before a strategy was renamed/removed) against `metrics` and
 * `bufferM`. `withinBuffer` above is left `undefined` for strategies whose pass
 * condition is a simple distance<=buffer check on their own `distanceM` — that
 * comparison is applied once, here, so each strategy only has to compute its
 * representative distance.
 */
function evaluate(strategyId, metrics, bufferM) {
  const strategy = STRATEGY_MAP.get(strategyId) || STRATEGY_MAP.get(DEFAULT_STRATEGY_ID);
  const result = strategy.evaluate(metrics, bufferM);
  const withinBuffer = result.withinBuffer === undefined
    ? Number.isFinite(result.distanceM) && result.distanceM <= bufferM
    : result.withinBuffer;
  return { withinBuffer, distanceM: Number.isFinite(result.distanceM) ? result.distanceM : null };
}

/** The strategy record for an id, falling back to the default for an unknown one. */
function strategyFor(strategyId) {
  return STRATEGY_MAP.get(strategyId) || STRATEGY_MAP.get(DEFAULT_STRATEGY_ID);
}

/**
 * How many live fixes `strategyId` needs before it may decide, given the admin's
 * `Settings.minFixesByStrategy`.
 *
 * Resolution order is: the configured value, clamped to that strategy's own floor
 * and `MAX_MIN_FIXES`; otherwise the strategy's default. Clamping rather than
 * rejecting matters here because this runs on the read path, on every submitted
 * fix — a value that predates a floor change (or was written before a strategy
 * was renamed) must still yield a usable number rather than throw mid-lecture.
 * The *write* path rejects out-of-range values outright, so the clamp is a
 * fallback for stored data, not the validation.
 *
 * @param {string} strategyId
 * @param {Map<string, number>|Object|null|undefined} configured
 * @returns {number}
 */
function minFixesFor(strategyId, configured) {
  const strategy = strategyFor(strategyId);
  const raw = configured instanceof Map
    ? configured.get(strategy.id)
    : (configured || {})[strategy.id];
  // `typeof`, not `Number(raw)`. Coercing would read `null` and `''` as 0 and
  // then clamp them up to the floor, which is a configured-looking answer for a
  // field nobody configured — and it would silently accept a string. Anything
  // that is not already a whole number means "not set", so use the default.
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return strategy.defaultMinFixes;
  return Math.min(MAX_MIN_FIXES, Math.max(strategy.floorMinFixes, raw));
}

/** Every strategy's effective minimum, for the admin dashboard to render. */
function resolvedMinFixes(configured) {
  const out = {};
  for (const s of STRATEGIES) out[s.id] = minFixesFor(s.id, configured);
  return out;
}

module.exports = {
  STRATEGIES,
  DEFAULT_STRATEGY_ID,
  MAX_MIN_FIXES,
  evaluate,
  strategyFor,
  minFixesFor,
  resolvedMinFixes,
};
