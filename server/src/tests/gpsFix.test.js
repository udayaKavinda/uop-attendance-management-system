jest.mock('../models/AttendanceAttempt', () => require('./helpers/gpsStateFakes').makeAttendanceAttemptModel());

const gpsFix = require('../services/gpsFix.service');
const geofenceLogic = require('../services/geofenceLogic.service');

function fix(lat, lng, accuracy = 10) {
  return { lat, lng, accuracy };
}

const BUFFERS = { nearBufferM: 50, farBufferM: 100 };

describe('gpsFix', () => {
  describe('computeCentroid / buffering', () => {
    it('returns null (not enough fixes) before the 3rd fix', async () => {
      const key = `student-${Date.now()}-a`;
      await gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      await gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      expect(await gpsFix.computeCentroid(key, 'session1')).toBeNull();
    });

    it('computes a centroid once 3 fixes have accumulated', async () => {
      const key = `student-${Date.now()}-b`;
      for (let i = 0; i < 3; i += 1) {
        await gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      }
      const centroid = await gpsFix.computeCentroid(key, 'session1');
      expect(centroid).not.toBeNull();
      expect(centroid.lat).toBeCloseTo(6.9, 5);
      expect(centroid.lng).toBeCloseTo(79.8, 5);
      expect(centroid.fixCount).toBe(3);
    });

    it('clearFixes resets the buffer for that (student, session)', async () => {
      const key = `student-${Date.now()}-c`;
      for (let i = 0; i < 3; i += 1) await gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      await gpsFix.clearFixes(key, 'session1');
      expect(await gpsFix.computeCentroid(key, 'session1')).toBeNull();
    });
  });

  describe('removeOutliersByMedianDistance', () => {
    it('drops a fix far from the tight cluster of the rest', () => {
      const fixes = [
        fix(6.9000, 79.8000),
        fix(6.9001, 79.8000),
        fix(6.9000, 79.8001),
        fix(6.9001, 79.8001),
        fix(10.0000, 79.8000), // ~344km away — a clear outlier
      ];
      const survivors = gpsFix.removeOutliersByMedianDistance(fixes);
      expect(survivors).toHaveLength(4);
      expect(survivors.some((f) => f.lat === 10)).toBe(false);
    });

    it('returns null when there are fewer than MIN_FIXES fixes', () => {
      expect(gpsFix.removeOutliersByMedianDistance([fix(1, 1), fix(1, 1)])).toBeNull();
    });

    // Regression: this used to fall back to returning the UNTRIMMED list, handing
    // back the very outlier it had just identified. A student with 2 perfect
    // in-room fixes plus one glitch then banded `far` instead of "keep collecting".
    it('reports "not ready" rather than the untrimmed set when trimming leaves too few', () => {
      const fixes = [
        fix(6.9000, 79.8000), fix(6.9000, 79.8000),
        fix(10.0000, 79.8000), // one wild glitch, at exactly MIN_FIXES total
      ];
      expect(gpsFix.removeOutliersByMedianDistance(fixes)).toBeNull();
    });
  });

  describe('accuracy normalisation', () => {
    // Android returns 0.0 from getAccuracy() when hasAccuracy() is false, so 0
    // means "unknown", never "perfect".
    it('treats accuracy 0 as unknown (pessimistic), not as the most precise fix', () => {
      expect(gpsFix.accuracyWeightedCentroid([fix(0, 0, 0)]).bestAccuracy).toBe(50);
      expect(gpsFix.accuracyWeightedCentroid([fix(0, 0, 0), fix(0, 0, 12)]).bestAccuracy).toBe(12);
    });

    it('does not let an accuracy-unknown fix win best_accuracy_fix', async () => {
      const square = [[79.8000, 6.9000], [79.8010, 6.9000], [79.8010, 6.9010], [79.8000, 6.9010]];
      const buffers = { ...BUFFERS, nearBufferLogic: 'best_accuracy_fix', farBufferLogic: 'best_accuracy_fix' };
      const key = `student-${Date.now()}-acc0`;
      let result;
      // Three genuinely precise fixes dead centre, plus one accuracy-unknown fix 6 km away.
      const inRoom = [6.9005, 79.8005];
      for (let i = 0; i < 4; i += 1) {
        result = await gpsFix.evaluateFix(key, 'session1', fix(inRoom[0], inRoom[1], 3), [{ polygon: square }], buffers);
      }
      result = await gpsFix.evaluateFix(key, 'session1', fix(6.85, 79.8005, 0), [{ polygon: square }], buffers);
      expect(result.band).toBe('inside');
      await gpsFix.clearFixes(key, 'session1');
    });
  });

  describe('accuracyWeightedCentroid', () => {
    it('weights a more accurate (lower-accuracy-value) fix more heavily', () => {
      const fixes = [
        fix(0, 0, 100), // noisy
        fix(1, 1, 1), // precise
      ];
      const centroid = gpsFix.accuracyWeightedCentroid(fixes);
      // The precise fix should dominate — centroid should sit much closer to (1,1) than (0,0).
      expect(centroid.lat).toBeGreaterThan(0.9);
      expect(centroid.lng).toBeGreaterThan(0.9);
    });

    it('reports the best accuracy among the contributing fixes', () => {
      expect(gpsFix.accuracyWeightedCentroid([fix(0, 0, 90), fix(0, 0, 12)]).bestAccuracy).toBe(12);
    });
  });

  describe('geofenceLogic strategies (band decisions delegate to these)', () => {
    it('accuracy_weighted_centroid passes iff the centroid distance is within the buffer', () => {
      const metrics = { fixDistances: [10, 90], centroidDistanceM: 45, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('accuracy_weighted_centroid', metrics, 50)).toMatchObject({
        withinBuffer: true, distanceM: 45,
      });
      expect(geofenceLogic.evaluate('accuracy_weighted_centroid', metrics, 40).withinBuffer).toBe(false);
    });

    it('any_point_within passes if the single closest fix is within the buffer', () => {
      const metrics = { fixDistances: [10, 90], centroidDistanceM: 45, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('any_point_within', metrics, 50)).toMatchObject({
        withinBuffer: true, distanceM: 10,
      });
    });

    it('all_points_within requires every fix inside the buffer', () => {
      const metrics = { fixDistances: [10, 90], centroidDistanceM: 45, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('all_points_within', metrics, 50)).toMatchObject({
        withinBuffer: false, distanceM: 90,
      });
      expect(geofenceLogic.evaluate('all_points_within', metrics, 100).withinBuffer).toBe(true);
    });

    it('majority_points_within needs more than half the fixes inside the buffer', () => {
      const metrics = { fixDistances: [10, 20, 90], centroidDistanceM: 40, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('majority_points_within', metrics, 50).withinBuffer).toBe(true);
      const worse = { fixDistances: [60, 70, 10], centroidDistanceM: 40, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('majority_points_within', worse, 50).withinBuffer).toBe(false);
    });

    it('falls back to the default strategy for an unrecognized id', () => {
      const metrics = { fixDistances: [10], centroidDistanceM: 45, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('not_a_real_strategy', metrics, 50)).toEqual(
        geofenceLogic.evaluate(geofenceLogic.DEFAULT_STRATEGY_ID, metrics, 50),
      );
    });

    it('median_distance passes iff the middle fix distance is within the buffer', () => {
      const metrics = { fixDistances: [10, 40, 90], centroidDistanceM: 45, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('median_distance', metrics, 50)).toMatchObject({
        withinBuffer: true, distanceM: 40,
      });
      expect(geofenceLogic.evaluate('median_distance', metrics, 39).withinBuffer).toBe(false);
    });

    it('best_accuracy_fix checks only the single most-precise fix, ignoring the rest', () => {
      // The most-precise fix (bestAccuracyFixDistanceM) sits inside the buffer even
      // though the other, noisier fixes do not.
      const metrics = { fixDistances: [10, 200, 200], centroidDistanceM: 150, bestAccuracyFixDistanceM: 10 };
      expect(geofenceLogic.evaluate('best_accuracy_fix', metrics, 50)).toMatchObject({
        withinBuffer: true, distanceM: 10,
      });
    });

    it('is inclusive at the exact buffer boundary (distance === bufferM passes)', () => {
      const metrics = { fixDistances: [50], centroidDistanceM: 50, bestAccuracyFixDistanceM: 50 };
      expect(geofenceLogic.evaluate('accuracy_weighted_centroid', metrics, 50).withinBuffer).toBe(true);
      expect(geofenceLogic.evaluate('median_distance', metrics, 50).withinBuffer).toBe(true);
      expect(geofenceLogic.evaluate('best_accuracy_fix', metrics, 50).withinBuffer).toBe(true);
    });

    it('fails one unit past the exact buffer boundary', () => {
      const metrics = { fixDistances: [50.1], centroidDistanceM: 50.1, bestAccuracyFixDistanceM: 50.1 };
      expect(geofenceLogic.evaluate('accuracy_weighted_centroid', metrics, 50).withinBuffer).toBe(false);
    });
  });

  describe('isPassBand', () => {
    it('passes only inside and near', () => {
      expect(gpsFix.isPassBand('inside')).toBe(true);
      expect(gpsFix.isPassBand('near')).toBe(true);
      expect(gpsFix.isPassBand('suspicious')).toBe(false);
      expect(gpsFix.isPassBand('far')).toBe(false);
      expect(gpsFix.isPassBand('unknown')).toBe(false);
    });
  });

  describe('evaluateFix (band decision)', () => {
    // ~110m tall x ~110m wide square near Colombo.
    const square = [[79.8000, 6.9000], [79.8010, 6.9000], [79.8010, 6.9010], [79.8000, 6.9010]];
    const geofences = [{ polygon: square }];

    it('is not ready before enough fixes accumulate, even standing inside the polygon', async () => {
      const key = `student-${Date.now()}-d`;
      const result = await gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005), geofences, BUFFERS);
      expect(result.ready).toBe(false);
      expect(result.centroid).toBeNull();
    });

    it('bands a centroid inside the polygon as "inside" after exactly 3 fixes (MIN_FIXES)', async () => {
      const key = `student-${Date.now()}-e`;
      let result;
      for (let i = 0; i < 3; i += 1) {
        result = await gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005), geofences, BUFFERS);
      }
      expect(result.ready).toBe(true);
      expect(result.band).toBe('inside');
      expect(result.distanceM).toBe(0);
      expect(result.centroid.fixCount).toBe(3);
    });

    it('bands a centroid just outside the polygon but inside the near buffer as "near"', async () => {
      const key = `student-${Date.now()}-f`;
      let result;
      // ~33m south of the polygon's lower edge.
      for (let i = 0; i < 3; i += 1) {
        result = await gpsFix.evaluateFix(key, 'session1', fix(6.8997, 79.8005), geofences, BUFFERS);
      }
      expect(result.band).toBe('near');
      expect(result.distanceM).toBeGreaterThan(0);
      expect(result.distanceM).toBeLessThanOrEqual(50);
    });

    it('bands a centroid between the buffers as "suspicious"', async () => {
      const key = `student-${Date.now()}-g`;
      let result;
      // ~78m south of the polygon.
      for (let i = 0; i < 3; i += 1) {
        result = await gpsFix.evaluateFix(key, 'session1', fix(6.8993, 79.8005), geofences, BUFFERS);
      }
      expect(result.band).toBe('suspicious');
    });

    it('bands a centroid beyond the far buffer as "far"', async () => {
      const key = `student-${Date.now()}-h`;
      let result;
      for (let i = 0; i < 3; i += 1) {
        result = await gpsFix.evaluateFix(key, 'session1', fix(0, 0), geofences, BUFFERS);
      }
      expect(result.ready).toBe(true);
      expect(result.band).toBe('far');
      expect(result.centroid).not.toBeNull();
    });

    // The accuracy gate (auto-banding poor fixes as "unknown") was removed:
    // every band decision now runs purely off distance, however inaccurate the
    // contributing fixes were reported to be.
    it('bands a centroid from very inaccurate fixes on distance alone, not "unknown"', async () => {
      const key = `student-${Date.now()}-i`;
      let result;
      // Standing dead centre of the polygon, every fix reported as +/-200m accurate.
      for (let i = 0; i < 3; i += 1) {
        result = await gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005, 200), geofences, BUFFERS);
      }
      expect(result.ready).toBe(true);
      expect(result.band).toBe('inside');
      expect(gpsFix.isPassBand(result.band)).toBe(true);
    });

    it('bands against the NEAREST of several buildings', async () => {
      const key = `student-${Date.now()}-j`;
      const farAway = [[10.0000, 10.0000], [10.0010, 10.0000], [10.0010, 10.0010], [10.0000, 10.0010]];
      let result;
      for (let i = 0; i < 3; i += 1) {
        result = await gpsFix.evaluateFix(
          key, 'session1', fix(6.9005, 79.8005), [{ polygon: farAway }, { polygon: square }], BUFFERS,
        );
      }
      expect(result.band).toBe('inside');
    });
  });
});
