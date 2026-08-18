const gpsFix = require('../services/gpsFix.service');

function fix(lat, lng, accuracy = 10) {
  return { lat, lng, accuracy };
}

describe('gpsFix', () => {
  beforeEach(() => {
    // Each test uses a fresh (student, session) key pair, so no explicit reset
    // of the module-level buffer is needed between tests.
  });

  describe('computeCentroid / evaluateFix buffering', () => {
    it('returns null (not enough fixes) before the 4th fix', () => {
      const key = `student-${Date.now()}-a`;
      gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      expect(gpsFix.computeCentroid(key, 'session1')).toBeNull();
    });

    it('computes a centroid once 4 fixes have accumulated', () => {
      const key = `student-${Date.now()}-b`;
      for (let i = 0; i < 4; i += 1) {
        gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      }
      const centroid = gpsFix.computeCentroid(key, 'session1');
      expect(centroid).not.toBeNull();
      expect(centroid.lat).toBeCloseTo(6.9, 5);
      expect(centroid.lng).toBeCloseTo(79.8, 5);
      expect(centroid.fixCount).toBe(4);
    });

    it('clearFixes resets the buffer for that (student, session)', () => {
      const key = `student-${Date.now()}-c`;
      for (let i = 0; i < 4; i += 1) gpsFix.addFix(key, 'session1', fix(6.9, 79.8));
      gpsFix.clearFixes(key, 'session1');
      expect(gpsFix.computeCentroid(key, 'session1')).toBeNull();
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

    it('returns null when there are fewer than 4 fixes', () => {
      expect(gpsFix.removeOutliersByMedianDistance([fix(1, 1), fix(1, 1)])).toBeNull();
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
  });

  describe('evaluateFix (full accept/reject decision)', () => {
    const square = [[79.8000, 6.9000], [79.8010, 6.9000], [79.8010, 6.9010], [79.8000, 6.9010]];
    const geofences = [{ polygon: square }];

    it('accepts once >= 4 fixes land the centroid inside the geofence', () => {
      const key = `student-${Date.now()}-d`;
      let result;
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005), geofences, 5);
      }
      expect(result.accepted).toBe(true);
      expect(result.centroid.fixCount).toBe(4);
    });

    it('stays pending (not accepted) when the centroid is outside every geofence and buffer', () => {
      const key = `student-${Date.now()}-e`;
      let result;
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(0, 0), geofences, 5);
      }
      expect(result.accepted).toBe(false);
      expect(result.centroid).not.toBeNull();
    });

    it('is not accepted before the 4th fix even if the location is inside the geofence', () => {
      const key = `student-${Date.now()}-f`;
      const result = gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005), geofences, 5);
      expect(result.accepted).toBe(false);
      expect(result.centroid).toBeNull();
    });
  });
});
