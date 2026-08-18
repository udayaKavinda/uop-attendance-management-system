const geofenceService = require('../../services/geofence.service');
const { validateGeofenceCreateBody, validateGeofenceUpdateBody } = require('../../validators/geofence.validator');

async function list(req, res) {
  const items = await geofenceService.listActive();
  return res.json({ items });
}

async function create(req, res) {
  const validated = validateGeofenceCreateBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const geofence = await geofenceService.createGeofence(validated);
  return res.json({ success: true, geofence });
}

async function update(req, res) {
  const validated = validateGeofenceUpdateBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const { ok, ...patch } = validated;
  const result = await geofenceService.updateGeofence(req.params.id, patch);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true, geofence: result.geofence });
}

async function remove(req, res) {
  const result = await geofenceService.softDeleteGeofence(req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true });
}

module.exports = { list, create, update, remove };
