const settingsService = require('../../services/settings.service');
const { validateSettingsBody, checkBufferOrder } = require('../../validators/settings.validator');
const { STRATEGIES, DEFAULT_STRATEGY_ID } = require('../../services/geofenceLogic.service');

/**
 * Full settings payload, including the geofence-logic dropdown's option list.
 *
 * The options belong in `shape()` — i.e. in EVERY settings response — rather than
 * being appended to the GET only. The client replaces its whole cached settings
 * object with whatever a response carries, and it re-reads the settings endpoint
 * just once per dashboard, so a PATCH reply that omitted the list silently emptied
 * both dropdowns until the screen was recreated. Worst case was self-inflicted:
 * choosing a strategy is itself a PATCH, so picking one option destroyed the menu.
 */
function shape(settings) {
  return {
    bleEnabled: settings.bleEnabled !== false,
    webAllowNonIos: settings.webAllowNonIos === true,
    nearBufferM: settings.nearBufferM,
    farBufferM: settings.farBufferM,
    nearBufferLogic: settings.nearBufferLogic || DEFAULT_STRATEGY_ID,
    farBufferLogic: settings.farBufferLogic || DEFAULT_STRATEGY_ID,
    geofenceLogicOptions: STRATEGIES.map(({ id, label, description }) => ({ id, label, description })),
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
