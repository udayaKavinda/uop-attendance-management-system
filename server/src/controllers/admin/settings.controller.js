const settingsService = require('../../services/settings.service');
const { validateSettingsBody, checkBufferOrder } = require('../../validators/settings.validator');

function shape(settings) {
  return {
    bleEnabled: settings.bleEnabled !== false,
    nearBufferM: settings.nearBufferM,
    farBufferM: settings.farBufferM,
    suspiciousBandAutoPass: settings.suspiciousBandAutoPass !== false,
    seedRate: settings.seedRate,
    seedWindowMs: settings.seedWindowMs,
    studentEmailDomain: settings.studentEmailDomain || '',
    minSupportedVersionCode: settings.minSupportedVersionCode || 0,
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

  const current = await settingsService.getSettings();
  const order = checkBufferOrder(current, patch);
  if (!order.ok) return res.status(order.status).json({ error: order.error });

  const settings = await settingsService.updateSettings(patch);
  return res.json({ success: true, ...shape(settings) });
}

module.exports = { get, update };
