'use strict';

/**
 * Deactivating a building has exactly the same effect on students as deleting
 * it: `findByIds` filters on `{ deleted: false, active: true }`, so an inactive
 * building is as invisible to banding as a deleted one. Every GPS attempt for a
 * session left with no active building falls into the `geofences.length === 0`
 * branch in attendance.service, which records an `unknown` verdict and returns
 * `{ ok: true, collecting: true }` — the phone shows "collecting" forever and
 * nobody is told anything is wrong.
 *
 * `softDeleteGeofence` has always refused while a live session references the
 * building. `updateGeofence` did not check at all, so the same outage was one
 * toggle away with no warning. These pin the guard on both paths.
 */

jest.mock('../models/Geofence', () => ({ findOne: jest.fn(), find: jest.fn(), create: jest.fn() }));
jest.mock('../models/LectureSession', () => ({ countDocuments: jest.fn() }));

const Geofence = require('../models/Geofence');
const LectureSession = require('../models/LectureSession');
const geofenceService = require('../services/geofence.service');

function fakeGeofence(over = {}) {
  return {
    _id: 'gf-1', name: 'DO1', active: true, deleted: false, polygon: [[80, 7], [81, 7], [81, 8]],
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('updateGeofence — deactivating a building that is still in use', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is refused while a live session references it, and the document is not saved', async () => {
    const gf = fakeGeofence();
    Geofence.findOne.mockResolvedValue(gf);
    LectureSession.countDocuments.mockResolvedValue(2);

    const res = await geofenceService.updateGeofence('gf-1', { active: false });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/2 sessions/);
    expect(gf.save).not.toHaveBeenCalled();
    expect(gf.active).toBe(true);
  });

  it('names a single session in the singular', async () => {
    Geofence.findOne.mockResolvedValue(fakeGeofence());
    LectureSession.countDocuments.mockResolvedValue(1);
    const res = await geofenceService.updateGeofence('gf-1', { active: false });
    expect(res.error).toMatch(/1 session /);
    expect(res.error).not.toMatch(/1 sessions/);
  });

  it('counts only sessions that still exist', async () => {
    Geofence.findOne.mockResolvedValue(fakeGeofence());
    LectureSession.countDocuments.mockResolvedValue(0);
    const res = await geofenceService.updateGeofence('gf-1', { active: false });
    expect(res.ok).toBe(true);
    expect(LectureSession.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: false }),
    );
  });

  it('allows deactivating a building nothing uses', async () => {
    const gf = fakeGeofence();
    Geofence.findOne.mockResolvedValue(gf);
    LectureSession.countDocuments.mockResolvedValue(0);

    const res = await geofenceService.updateGeofence('gf-1', { active: false });

    expect(res.ok).toBe(true);
    expect(gf.active).toBe(false);
    expect(gf.save).toHaveBeenCalled();
  });

  it('does not run the in-use check when the patch leaves active alone', async () => {
    const gf = fakeGeofence();
    Geofence.findOne.mockResolvedValue(gf);

    const res = await geofenceService.updateGeofence('gf-1', { name: 'Renamed' });

    expect(res.ok).toBe(true);
    expect(gf.name).toBe('Renamed');
    expect(LectureSession.countDocuments).not.toHaveBeenCalled();
  });

  it('lets an in-use building be re-activated — the guard is one-way', async () => {
    const gf = fakeGeofence({ active: false });
    Geofence.findOne.mockResolvedValue(gf);
    LectureSession.countDocuments.mockResolvedValue(3);

    const res = await geofenceService.updateGeofence('gf-1', { active: true });

    expect(res.ok).toBe(true);
    expect(gf.active).toBe(true);
  });

  it('still allows a polygon edit on an in-use building', async () => {
    const gf = fakeGeofence();
    Geofence.findOne.mockResolvedValue(gf);
    LectureSession.countDocuments.mockResolvedValue(4);

    const res = await geofenceService.updateGeofence('gf-1', { polygon: [[1, 1], [2, 2], [3, 3]] });

    expect(res.ok).toBe(true);
    expect(gf.save).toHaveBeenCalled();
  });
});
