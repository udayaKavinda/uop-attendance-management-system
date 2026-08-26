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

module.exports = { healthz, appVersion };
