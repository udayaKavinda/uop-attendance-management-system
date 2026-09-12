const settingsService = require('../../services/settings.service');
const { validateSettingsBody, checkBufferOrder } = require('../../validators/settings.validator');
const {
  STRATEGIES, DEFAULT_STRATEGY_ID, MAX_MIN_FIXES, resolvedMinFixes,
} = require('../../services/geofenceLogic.service');

/** Mongoose Map or plain object -> plain object, so both sides can be spread. */
function asPlainObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return typeof value.toObject === 'function' ? value.toObject() : { ...value };
}

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
    // Each option carries its own bounds so the dashboard can render and
    // pre-validate the field without hardcoding per-strategy numbers that would
    // then have to be kept in step across a release boundary.
    geofenceLogicOptions: STRATEGIES.map(({
      id, label, description, defaultMinFixes, floorMinFixes,
    }) => ({
      id, label, description, defaultMinFixes, floorMinFixes, maxMinFixes: MAX_MIN_FIXES,
    })),
    // Resolved, not raw: every strategy appears with the value actually in force,
    // so the dashboard never has to reproduce the fallback rules to show a number.
    minFixesByStrategy: resolvedMinFixes(settings.minFixesByStrategy),
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

  // Merge rather than replace: the validator returns only the strategies the
  // caller named, and `$set` on a Map overwrites the whole thing — so saving one
  // strategy's minimum would reset every other strategy to its default.
  if (patch.minFixesByStrategy) {
    patch.minFixesByStrategy = {
      ...asPlainObject(current.minFixesByStrategy),
      ...patch.minFixesByStrategy,
    };
  }

  const settings = await settingsService.updateSettings(patch);
  return res.json({ success: true, ...shape(settings) });
}

module.exports = { get, update };
