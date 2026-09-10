const Geofence = require('../models/Geofence');
const LectureSession = require('../models/LectureSession');

async function listActive() {
  return Geofence.find({ deleted: false, active: true }).sort({ name: 1 });
}

async function findByIds(ids) {
  return Geofence.find({ _id: { $in: ids }, deleted: false, active: true });
}

async function createGeofence({ name, polygon }) {
  return Geofence.create({ name, polygon });
}

async function updateGeofence(id, patch) {
  const geofence = await Geofence.findOne({ _id: id, deleted: false });
  if (!geofence) return { ok: false, status: 404, error: 'Geofence not found' };

  // Switching a building off is the same outage as deleting it, so it gets the
  // same guard — see softDeleteGeofence below for the reasoning. findByIds
  // filters `{ deleted: false, active: true }`, so banding cannot tell an
  // inactive building from a deleted one: every GPS attempt for a session left
  // with no active building lands in attendance.service's `geofences.length === 0`
  // branch, which records `unknown` and answers `{ ok: true, collecting: true }`.
  // The student's phone says "collecting" until it gives up, no error is shown,
  // and the lecturer finds out when the register comes back empty. Only the
  // delete path checked for this; one toggle produced the identical outage
  // silently.
  //
  // One-way on purpose: turning a building back ON is always safe, and blocking
  // it would strand exactly the admin trying to undo the mistake.
  if (patch.active === false && geofence.active !== false) {
    const inUse = await LectureSession.countDocuments({
      buildings: geofence._id,
      deleted: false,
    });
    if (inUse > 0) {
      return {
        ok: false,
        status: 400,
        error: `Cannot switch off this building because ${inUse} session${inUse === 1 ? '' : 's'} `
          + `still use${inUse === 1 ? 's' : ''} it, and attendance would stop being recorded for `
          + `${inUse === 1 ? 'it' : 'them'} without warning. Remove it from those sessions first.`,
      };
    }
  }

  if (patch.name !== undefined) geofence.name = patch.name;
  if (patch.polygon !== undefined) geofence.polygon = patch.polygon;
  if (patch.active !== undefined) geofence.active = patch.active;
  await geofence.save();
  return { ok: true, geofence };
}

/**
 * Soft-delete, refused while any live session still references this building.
 *
 * A building in use is not the admin's to remove out from under a timetable, even
 * when the session lists other buildings alongside it: the polygon is part of how
 * that session decides who is present, so dropping it silently shrinks the area
 * students are checked against. Take it off the sessions first, deliberately, and
 * the delete is then allowed.
 *
 * Only sessions that still exist count. A soft-deleted session never runs again,
 * so a building referenced solely by deleted sessions is free to remove.
 */
async function softDeleteGeofence(id) {
  const geofence = await Geofence.findOne({ _id: id, deleted: false });
  if (!geofence) return { ok: false, status: 404, error: 'Geofence not found' };

  const inUse = await LectureSession.countDocuments({
    buildings: geofence._id,
    deleted: false,
  });
  if (inUse > 0) {
    return {
      ok: false,
      status: 400,
      error: `Cannot remove this building because ${inUse} session${inUse === 1 ? '' : 's'} `
        + `still use${inUse === 1 ? 's' : ''} it. Remove it from those sessions, or delete `
        + `them first.`,
    };
  }

  geofence.deleted = true;
  geofence.active = false;
  await geofence.save();
  return { ok: true };
}

module.exports = {
  listActive, findByIds, createGeofence, updateGeofence, softDeleteGeofence,
};
