const mongoose = require('mongoose');
const settingsService = require('../services/settings.service');

function healthz(req, res) {
  const connected = mongoose.connection?.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'down',
    mongo: mongoose.connection?.readyState ?? 0,
    uptime: Math.round(process.uptime()),
    memory: process.memoryUsage().heapUsed,
    version: process.env.npm_package_version || null,
  });
}

/** Public: the Android app checks this on launch to decide whether to force an update. */
async function appVersion(req, res) {
  const settings = await settingsService.getSettings();
  res.json({ minSupportedVersionCode: settings.minSupportedVersionCode || 0 });
}

/**
 * Public: the browser client reads this before deciding whether to serve a
 * non-iOS device. It must be unauthenticated, because that decision is made
 * before anyone has signed in.
 *
 * Deliberately narrow — one boolean. The rest of the settings singleton is
 * admin-only, and nothing else here should leak to an anonymous caller.
 */
async function webConfig(req, res) {
  const settings = await settingsService.getSettings();
  res.json({ allowNonIos: settings.webAllowNonIos === true });
}

module.exports = { healthz, appVersion, webConfig };
