/**
 * Pluggable "is this student within the buffer?" strategies. The near and far
 * bands each pick one independently (`Settings.nearBufferLogic`/`farBufferLogic`),
 * so an admin can e.g. require a majority of fixes inside the near buffer while
 * only needing any single fix inside the far one.
 *
 * Every strategy receives the same precomputed `metrics` for one verdict attempt
 * (built once in `gpsFix.service.js` and reused for both band checks) and a
 * buffer distance in meters, and returns whether that buffer is satisfied plus a
 * representative distance for reporting/comments.
 */

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const STRATEGIES = [
  {
    id: 'accuracy_weighted_centroid',
    label: 'Accuracy-weighted centroid',
    description: 'Average every fix, weighted toward the more precise ones, then check the average position.',
    evaluate(metrics, bufferM) {
      const distanceM = metrics.centroidDistanceM;
      return { withinBuffer: distanceM <= bufferM, distanceM };
    },
  },
  {
    id: 'any_point_within',
    label: 'Any point within geofence',
    description: 'Pass as soon as a single collected fix lands inside the buffer.',
    evaluate(metrics) {
      const distanceM = Math.min(...metrics.fixDistances);
      return { withinBuffer: undefined, distanceM };
    },
  },
  {
    id: 'majority_points_within',
    label: 'Most points within geofence',
    description: 'Pass when more than half of the collected fixes land inside the buffer.',
    evaluate(metrics, bufferM) {
      const within = metrics.fixDistances.filter((d) => d <= bufferM).length;
      return { withinBuffer: within > metrics.fixDistances.length / 2, distanceM: median(metrics.fixDistances) };
    },
  },
  {
    id: 'all_points_within',
    label: 'All points within geofence',
    // Deliberately blunt: with real GPS drift a single stray reading out of ~30
    // fails the whole attempt, so a student who never left the room can still be
    // flagged. Measured: 3 fixes dead inside the polygon plus one 166 m drift
    // bands as `far`. Offered for small, very tight geofences only.
    description: 'Strictest option — every collected fix must land inside the buffer. '
      + 'One stray GPS reading fails the whole attempt, so most rooms should not use this.',
    evaluate(metrics) {
      const distanceM = Math.max(...metrics.fixDistances);
      return { withinBuffer: undefined, distanceM };
    },
  },
  {
    id: 'median_distance',
    label: 'Median distance',
    description: 'Check the middle distance across all fixes — robust to a single outlier fix either way.',
    evaluate(metrics) {
      return { withinBuffer: undefined, distanceM: median(metrics.fixDistances) };
    },
  },
  {
    id: 'best_accuracy_fix',
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

module.exports = {
  STRATEGIES,
  DEFAULT_STRATEGY_ID,
  evaluate,
};
