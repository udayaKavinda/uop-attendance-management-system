const gpsFix = require('../services/gpsFix.service');

function fix(lat, lng, accuracy = 10) {
  return { lat, lng, accuracy };
}

const BUFFERS = { nearBufferM: 50, farBufferM: 100 };

describe('gpsFix', () => {
  describe('computeCentroid / buffering', () => {
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

    it('reports the best accuracy among the contributing fixes', () => {
      expect(gpsFix.accuracyWeightedCentroid([fix(0, 0, 90), fix(0, 0, 12)]).bestAccuracy).toBe(12);
    });
  });

  describe('classifyDistance', () => {
    it('sorts distances into the four bands', () => {
      expect(gpsFix.classifyDistance(0, BUFFERS)).toBe('inside');
      expect(gpsFix.classifyDistance(30, BUFFERS)).toBe('near');
      expect(gpsFix.classifyDistance(50, BUFFERS)).toBe('near');
      expect(gpsFix.classifyDistance(51, BUFFERS)).toBe('suspicious');
      expect(gpsFix.classifyDistance(100, BUFFERS)).toBe('suspicious');
      expect(gpsFix.classifyDistance(101, BUFFERS)).toBe('far');
    });

    it('treats a non-finite distance as unknown rather than far', () => {
      expect(gpsFix.classifyDistance(Infinity, BUFFERS)).toBe('unknown');
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

    it('is not ready before the 4th fix even when standing inside the polygon', () => {
      const key = `student-${Date.now()}-d`;
      const result = gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005), geofences, BUFFERS);
      expect(result.ready).toBe(false);
      expect(result.centroid).toBeNull();
    });

    it('bands a centroid inside the polygon as "inside"', () => {
      const key = `student-${Date.now()}-e`;
      let result;
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005), geofences, BUFFERS);
      }
      expect(result.ready).toBe(true);
      expect(result.band).toBe('inside');
      expect(result.distanceM).toBe(0);
      expect(result.centroid.fixCount).toBe(4);
    });

    it('bands a centroid just outside the polygon but inside the near buffer as "near"', () => {
      const key = `student-${Date.now()}-f`;
      let result;
      // ~33m south of the polygon's lower edge.
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(6.8997, 79.8005), geofences, BUFFERS);
      }
      expect(result.band).toBe('near');
      expect(result.distanceM).toBeGreaterThan(0);
      expect(result.distanceM).toBeLessThanOrEqual(50);
    });

    it('bands a centroid between the buffers as "suspicious"', () => {
      const key = `student-${Date.now()}-g`;
      let result;
      // ~78m south of the polygon.
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(6.8993, 79.8005), geofences, BUFFERS);
      }
      expect(result.band).toBe('suspicious');
    });

    it('bands a centroid beyond the far buffer as "far"', () => {
      const key = `student-${Date.now()}-h`;
      let result;
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(0, 0), geofences, BUFFERS);
      }
      expect(result.ready).toBe(true);
      expect(result.band).toBe('far');
      expect(result.centroid).not.toBeNull();
    });

    it('refuses to band a centroid built only from very inaccurate fixes', () => {
      const key = `student-${Date.now()}-i`;
      let result;
      // Standing dead centre of the polygon, but every fix is +/-200m — the
      // position is meaningless, so it must not silently pass as "inside".
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(key, 'session1', fix(6.9005, 79.8005, 200), geofences, BUFFERS);
      }
      expect(result.ready).toBe(true);
      expect(result.band).toBe('unknown');
      expect(gpsFix.isPassBand(result.band)).toBe(false);
    });

    it('bands against the NEAREST of several buildings', () => {
      const key = `student-${Date.now()}-j`;
      const farAway = [[10.0000, 10.0000], [10.0010, 10.0000], [10.0010, 10.0010], [10.0000, 10.0010]];
      let result;
      for (let i = 0; i < 4; i += 1) {
        result = gpsFix.evaluateFix(
          key, 'session1', fix(6.9005, 79.8005), [{ polygon: farAway }, { polygon: square }], BUFFERS,
        );
      }
      expect(result.band).toBe('inside');
    });
  });
});
