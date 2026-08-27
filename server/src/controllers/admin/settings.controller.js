const settingsService = require('../../services/settings.service');
const { validateSettingsBody, checkBufferOrder } = require('../../validators/settings.validator');
const { STRATEGIES, DEFAULT_STRATEGY_ID } = require('../../services/geofenceLogic.service');

function shape(settings) {
  return {
    bleEnabled: settings.bleEnabled !== false,
    nearBufferM: settings.nearBufferM,
    farBufferM: settings.farBufferM,
    nearBufferLogic: settings.nearBufferLogic || DEFAULT_STRATEGY_ID,
    farBufferLogic: settings.farBufferLogic || DEFAULT_STRATEGY_ID,
    seedRate: settings.seedRate,
    seedWindowMs: settings.seedWindowMs,
    studentEmailDomain: settings.studentEmailDomain || '',
    minSupportedVersionCode: settings.minSupportedVersionCode || 0,
  };
}

async function get(req, res) {
  const settings = await settingsService.getSettings();
  // The dropdown's option list travels with the settings response rather than
  // living as a separate endpoint — it's small, fixed, and only the settings
  // screen needs it.
  return res.json({ ...shape(settings), geofenceLogicOptions: STRATEGIES.map(({ id, label, description }) => ({ id, label, description })) });
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
