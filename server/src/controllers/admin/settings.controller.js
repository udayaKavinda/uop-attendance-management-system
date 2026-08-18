const settingsService = require('../../services/settings.service');
const { validateSettingsBody } = require('../../validators/settings.validator');

function shape(settings) {
  return {
    manualCodeAllowed: settings.manualCodeAllowed,
    bluetoothAllowed: settings.bluetoothAllowed,
    geofenceAllowed: settings.geofenceAllowed,
    // Derived so the create-session UI doesn't have to re-implement the rule.
    allowedVerifications: settingsService.allowedVerifications(settings),
    seedRate: settings.seedRate,
    seedWindowMs: settings.seedWindowMs,
    bufferGpsOnly: settings.bufferGpsOnly,
    bufferGpsBle: settings.bufferGpsBle,
  };
}

async function get(req, res) {
  const settings = await settingsService.getSettings();
  return res.json(shape(settings));
}

async function update(req, res) {
  const validated = validateSettingsBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const { ok, ...patch } = validated;
  const settings = await settingsService.updateSettings(patch);
  return res.json({ success: true, ...shape(settings) });
}

module.exports = { get, update };
