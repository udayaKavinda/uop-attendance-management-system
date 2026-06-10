const mongoose = require('mongoose');

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

module.exports = { healthz };
