const {
  haversineMeters, isPointInPolygon, distanceToPolygonBoundary, distanceToNearestGeofenceMeters,
} = require('../utils/geo');

// A ~111m x ~111m square centered near the equator/prime-meridian-ish latitude
// band, small enough that the equirectangular approximation is exact to well
// under a meter. 0.001 degree of latitude ≈ 111 m.
const SQUARE = [
  [0, 0],
  [0.001, 0],
  [0.001, 0.001],
  [0, 0.001],
];

describe('geo', () => {
  describe('haversineMeters', () => {
    it('returns 0 for identical points', () => {
      expect(haversineMeters(6.9, 79.8, 6.9, 79.8)).toBe(0);
    });

    it('returns roughly 111km for 1 degree of latitude', () => {
      const d = haversineMeters(0, 0, 1, 0);
      expect(d).toBeGreaterThan(110_000);
      expect(d).toBeLessThan(112_000);
    });
  });

  describe('isPointInPolygon', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

    it('returns true for a point well inside', () => {
      expect(isPointInPolygon([5, 5], square)).toBe(true);
    });

    it('returns false for a point well outside', () => {
      expect(isPointInPolygon([50, 50], square)).toBe(false);
    });

    it('returns false for a point just outside an edge', () => {
      expect(isPointInPolygon([-1, 5], square)).toBe(false);
    });
  });

  describe('distanceToPolygonBoundary', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

    it('is ~0 for a point on an edge', () => {
      expect(distanceToPolygonBoundary([5, 0], square)).toBeCloseTo(0, 5);
    });

    it('is the perpendicular distance for a point outside a flat edge', () => {
      expect(distanceToPolygonBoundary([5, -3], square)).toBeCloseTo(3, 5);
    });
  });

  describe('distanceToNearestGeofenceMeters', () => {
    it('is 0 for a point inside the polygon', () => {
      // Center of the square, in [lat, lng] order matching the function signature.
      expect(distanceToNearestGeofenceMeters(0.0005, 0.0005, [SQUARE])).toBe(0);
    });

    it('is a large distance for a point well outside every polygon', () => {
      expect(distanceToNearestGeofenceMeters(1, 1, [SQUARE])).toBeGreaterThan(10);
    });

    it('measures a short distance for a point just outside the boundary', () => {
      // ~5.5m north of the square's top edge (0.00005 deg lat ≈ 5.5m).
      const justOutside = 0.001 + 0.00005;
      expect(distanceToNearestGeofenceMeters(justOutside, 0.0005, [SQUARE])).toBeLessThan(10);
    });

    it('picks the nearest of several polygons rather than the first', () => {
      const farSquare = [[10, 10], [10.001, 10], [10.001, 10.001], [10, 10.001]];
      const near = distanceToNearestGeofenceMeters(0.0005, 0.0005, [farSquare, SQUARE]);
      expect(near).toBe(0);
    });

    it('skips a degenerate (fewer than 3 vertex) polygon rather than throwing', () => {
      const degenerate = [[0, 0], [1, 1]];
      expect(distanceToNearestGeofenceMeters(0.0005, 0.0005, [degenerate, SQUARE])).toBe(0);
    });
  });
});
