'use strict';

/**
 * The per-strategy GPS sample requirement: how it resolves, what bounds it keeps,
 * and how the two bands interact when they need different sample sizes.
 *
 * The reason this is its own suite rather than extra cases in `gpsFix.test.js` is
 * that the interesting behaviour is a *relationship* between three pieces — the
 * strategy registry's floors, the admin's stored map, and `evaluateBand`'s
 * readiness — and each of the three can be wrong in a way the other two hide.
 */

const geofenceLogic = require('../services/geofenceLogic.service');
const { validateSettingsBody } = require('../validators/settings.validator');

const {
  STRATEGIES, MAX_MIN_FIXES, minFixesFor, resolvedMinFixes, strategyFor,
} = geofenceLogic;

// A ~110 m square; `INSIDE` sits in it, `OUT` is ~780 m south of it.
const SQUARE = [[79.8000, 6.9000], [79.8010, 6.9000], [79.8010, 6.9010], [79.8000, 6.9010]];
const POLYGONS = [SQUARE];
const at = (lat, lng, accuracy = 5) => ({ lat, lng, accuracy, ts: Date.now() });
const INSIDE = at(6.9005, 79.8005);
const OUT = at(6.8930, 79.8005);

// Required after the constants so the mock-free service sees the real registry.
const gpsFix = require('../services/gpsFix.service');

const SINGLE_FIX_STRATEGIES = ['any_point_within', 'best_accuracy_fix'];
const MULTI_POINT_STRATEGIES = [
  'accuracy_weighted_centroid', 'majority_points_within', 'all_points_within', 'median_distance',
];

describe('the strategy registry declares its own sample requirement', () => {
  test('every strategy declares both a default and a floor', () => {
    for (const s of STRATEGIES) {
      expect(Number.isInteger(s.defaultMinFixes)).toBe(true);
      expect(Number.isInteger(s.floorMinFixes)).toBe(true);
      expect(s.defaultMinFixes).toBeGreaterThanOrEqual(s.floorMinFixes);
      expect(s.defaultMinFixes).toBeLessThanOrEqual(MAX_MIN_FIXES);
    }
  });

  /**
   * The load-bearing invariant. At a sample of one, `fixDistances` has a single
   * element, so its min, max and median coincide, the centroid IS that fix and
   * the best-accuracy fix IS that fix — every strategy returns the same answer.
   * A floor of 1 on `all_points_within` would therefore not loosen it, it would
   * turn the strictest strategy into the loosest one under a name that still
   * warns against stray readings. At two, `all_points_within` and
   * `majority_points_within` still coincide ("more than half of 2" is 2), so 3
   * is the smallest sample at which all six rules are distinct.
   */
  test.each(MULTI_POINT_STRATEGIES)('%s floors at 3, the smallest distinguishing sample', (id) => {
    expect(strategyFor(id).floorMinFixes).toBe(3);
  });

  test('at two fixes `all_points_within` and `majority_points_within` still coincide', () => {
    const two = { fixDistances: [10, 500], centroidDistanceM: 255, bestAccuracyFixDistanceM: 10 };
    const all = geofenceLogic.evaluate('all_points_within', two, 50);
    const majority = geofenceLogic.evaluate('majority_points_within', two, 50);
    expect(all.withinBuffer).toBe(majority.withinBuffer);
  });

  test.each(SINGLE_FIX_STRATEGIES)('%s may floor at 1 but defaults higher', (id) => {
    const s = strategyFor(id);
    expect(s.floorMinFixes).toBe(1);
    // The default sits above the floor as a settling allowance, not a safety
    // margin: nothing filters the sample, so a second reading cannot outvote a
    // bad first one — it only avoids deciding off a cold start's coarsest fix.
    expect(s.defaultMinFixes).toBeGreaterThan(s.floorMinFixes);
  });

  test('at one fix every strategy really does give the same answer', () => {
    // Not an assertion about intent — the actual arithmetic, so the floors above
    // are justified by behaviour rather than by the comment beside them. Driven
    // through `evaluate` with a one-fix metrics object rather than through
    // `evaluateBand`, precisely because the floors would refuse to let the
    // multi-point strategies run on a sample this small.
    const d = 780;
    const oneFix = { fixDistances: [d], centroidDistanceM: d, bestAccuracyFixDistanceM: d };

    const answers = STRATEGIES.map((s) => JSON.stringify(geofenceLogic.evaluate(s.id, oneFix, 50)));
    expect(new Set(answers).size).toBe(1);

    // And the same holds when the single fix is inside the buffer, which is the
    // direction that matters: `all_points_within` would pass on one stray reading.
    const inBuffer = { fixDistances: [0], centroidDistanceM: 0, bestAccuracyFixDistanceM: 0 };
    const passes = STRATEGIES.map((s) => geofenceLogic.evaluate(s.id, inBuffer, 50).withinBuffer);
    expect(passes).toEqual(passes.map(() => true));
  });
});

describe('minFixesFor resolution', () => {
  test('falls back to the strategy default when nothing is configured', () => {
    for (const s of STRATEGIES) {
      expect(minFixesFor(s.id, null)).toBe(s.defaultMinFixes);
      expect(minFixesFor(s.id, undefined)).toBe(s.defaultMinFixes);
      expect(minFixesFor(s.id, {})).toBe(s.defaultMinFixes);
    }
  });

  test('reads a configured value, from a plain object or a Mongoose Map alike', () => {
    expect(minFixesFor('any_point_within', { any_point_within: 5 })).toBe(5);
    expect(minFixesFor('any_point_within', new Map([['any_point_within', 5]]))).toBe(5);
  });

  test('ignores a value stored against a different strategy', () => {
    expect(minFixesFor('any_point_within', { median_distance: 9 })).toBe(2);
  });

  /**
   * The read path clamps where the write path rejects. It runs on every submitted
   * fix, so it has to yield a usable number even for data written before a floor
   * moved — throwing or returning NaN there would fail a live lecture.
   */
  test('clamps a stored value that is out of range rather than throwing', () => {
    expect(minFixesFor('all_points_within', { all_points_within: 1 })).toBe(3);
    expect(minFixesFor('any_point_within', { any_point_within: 0 })).toBe(1);
    expect(minFixesFor('any_point_within', { any_point_within: 999 })).toBe(MAX_MIN_FIXES);
  });

  test.each([['a string', '4'], ['a fraction', 2.5], ['null', null], ['NaN', NaN]])(
    'falls back to the default for %s',
    (_label, value) => {
      expect(minFixesFor('any_point_within', { any_point_within: value })).toBe(2);
    },
  );

  test('an unknown strategy id resolves through the default strategy', () => {
    expect(minFixesFor('not_a_real_strategy', null))
      .toBe(strategyFor(geofenceLogic.DEFAULT_STRATEGY_ID).defaultMinFixes);
  });

  test('resolvedMinFixes reports every strategy, so the dashboard needs no fallback rules', () => {
    const resolved = resolvedMinFixes({ any_point_within: 4 });
    expect(Object.keys(resolved).sort()).toEqual(STRATEGIES.map((s) => s.id).sort());
    expect(resolved.any_point_within).toBe(4);
    expect(resolved.accuracy_weighted_centroid).toBe(3);
  });
});

describe('evaluateBand honours the resolved minimum', () => {
  test('is not ready below the minimum and ready at it', () => {
    const cfg = { any_point_within: 2 };
    expect(gpsFix.evaluateBand([INSIDE], POLYGONS, 'any_point_within', 50, cfg).ready).toBe(false);
    expect(gpsFix.evaluateBand([INSIDE, INSIDE], POLYGONS, 'any_point_within', 50, cfg).ready).toBe(true);
  });

  test('a raised minimum delays a strategy that would otherwise be ready', () => {
    const sample = [INSIDE, INSIDE, INSIDE];
    expect(gpsFix.evaluateBand(sample, POLYGONS, 'any_point_within', 50, { any_point_within: 4 }).ready)
      .toBe(false);
    expect(gpsFix.evaluateBand(sample, POLYGONS, 'any_point_within', 50, { any_point_within: 3 }).ready)
      .toBe(true);
  });

  /**
   * Nothing filters the sample any more, at any size. This is the behaviour the
   * trimmer's removal bought and the behaviour it cost, in one assertion: a wild
   * reading reaches the strategy, so `any_point_within` honours it (the pass its
   * description promises) and `all_points_within` is broken by it.
   */
  test('a wild reading is never filtered out, whatever the sample size', () => {
    const glitch = at(7.4806, 80.5918); // ~25 km away
    for (const sample of [[glitch], [glitch, INSIDE], [INSIDE, INSIDE, INSIDE, glitch]]) {
      const band = gpsFix.evaluateBand(sample, POLYGONS, 'median_distance', 50, { median_distance: 3 });
      if (band.ready) expect(band.centroid.fixCount).toBe(sample.length);
    }

    // The inside fix is a minority of one and is still honoured.
    const anyPoint = gpsFix.evaluateBand(
      [OUT, OUT, OUT, INSIDE], POLYGONS, 'any_point_within', 50, { any_point_within: 1 },
    );
    expect(anyPoint.withinBuffer).toBe(true);
    expect(anyPoint.centroid.fixCount).toBe(4);

    // And the same minority reading fails the strictest rule outright.
    const allPoints = gpsFix.evaluateBand(
      [INSIDE, INSIDE, INSIDE, OUT], POLYGONS, 'all_points_within', 50, null,
    );
    expect(allPoints.withinBuffer).toBe(false);
  });

  test('median_distance is the outlier-resistant option now that nothing pre-filters', () => {
    const glitch = at(7.4806, 80.5918);
    // Three in-room readings plus one 25 km glitch: the median ignores it, the
    // accuracy-weighted centroid does not.
    const sample = [INSIDE, INSIDE, INSIDE, glitch];
    expect(gpsFix.evaluateBand(sample, POLYGONS, 'median_distance', 50, null).withinBuffer).toBe(true);
    expect(gpsFix.evaluateBand(sample, POLYGONS, 'accuracy_weighted_centroid', 50, null).withinBuffer)
      .toBe(false);
  });
});

describe('PATCH /api/admin/settings validation of minFixesByStrategy', () => {
  const ok = (patch) => validateSettingsBody({ minFixesByStrategy: patch });

  test('accepts a partial map and returns only what was named', () => {
    const res = ok({ any_point_within: 1 });
    expect(res.ok).toBe(true);
    expect(res.minFixesByStrategy).toEqual({ any_point_within: 1 });
  });

  test('rejects an unknown strategy id by name', () => {
    const res = ok({ nope: 3 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('nope');
  });

  /**
   * Rejects rather than clamps, and says why: an admin typing 1 against
   * `all_points_within` has asked for something that would silently make the
   * strictest strategy the loosest, and that is worth a sentence rather than a
   * quiet correction to 3.
   */
  test('rejects a value below a multi-point strategy floor, and explains', () => {
    const res = ok({ all_points_within: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('All points within geofence');
    expect(res.error).toContain('distinguishable');
  });

  test('accepts 1 for a single-fix strategy without the extra warning', () => {
    expect(ok({ any_point_within: 1 }).ok).toBe(true);
    expect(ok({ best_accuracy_fix: 1 }).ok).toBe(true);
  });

  test(`rejects above ${MAX_MIN_FIXES}, the ceiling a bad room can never reach`, () => {
    expect(ok({ any_point_within: MAX_MIN_FIXES }).ok).toBe(true);
    expect(ok({ any_point_within: MAX_MIN_FIXES + 1 }).ok).toBe(false);
  });

  test.each([['a fraction', 2.5], ['a string', '3'], ['a boolean', true], ['null', null]])(
    'rejects %s as a value',
    (_label, value) => {
      expect(ok({ any_point_within: value }).ok).toBe(false);
    },
  );

  test.each([['an array', []], ['a string', 'three'], ['null', null], ['a number', 3]])(
    'rejects %s as the map itself',
    (_label, value) => {
      expect(validateSettingsBody({ minFixesByStrategy: value }).ok).toBe(false);
    },
  );

  test('rejects an empty map rather than treating it as a no-op write', () => {
    expect(ok({}).ok).toBe(false);
  });

  test('does not disturb the other settings fields', () => {
    const res = validateSettingsBody({ nearBufferM: 40, minFixesByStrategy: { median_distance: 6 } });
    expect(res.ok).toBe(true);
    expect(res.nearBufferM).toBe(40);
    expect(res.minFixesByStrategy).toEqual({ median_distance: 6 });
  });
});
