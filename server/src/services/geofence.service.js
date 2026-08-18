const Geofence = require('../models/Geofence');

async function listActive() {
  return Geofence.find({ deleted: false }).sort({ name: 1 });
}

async function findByIds(ids) {
  return Geofence.find({ _id: { $in: ids }, deleted: false });
}

async function createGeofence({ name, polygon }) {
  return Geofence.create({ name, polygon });
}

async function updateGeofence(id, patch) {
  const geofence = await Geofence.findOne({ _id: id, deleted: false });
  if (!geofence) return { ok: false, status: 404, error: 'Geofence not found' };
  if (patch.name !== undefined) geofence.name = patch.name;
  if (patch.polygon !== undefined) geofence.polygon = patch.polygon;
  if (patch.active !== undefined) geofence.active = patch.active;
  await geofence.save();
  return { ok: true, geofence };
}

/**
 * Soft-delete. Sessions that still reference this id keep the stale reference —
 * geofence-validation reads always filter `deleted: false`, so a session left
 * with zero live buildings fails closed (explicit error) rather than silently
 * validating against nothing.
 */
async function softDeleteGeofence(id) {
  const geofence = await Geofence.findOne({ _id: id, deleted: false });
  if (!geofence) return { ok: false, status: 404, error: 'Geofence not found' };
  geofence.deleted = true;
  geofence.active = false;
  await geofence.save();
  return { ok: true };
}

module.exports = {
  listActive, findByIds, createGeofence, updateGeofence, softDeleteGeofence,
};
