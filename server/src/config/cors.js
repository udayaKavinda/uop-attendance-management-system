const cors = require('cors');
const { CAPACITOR_RETURN_ORIGINS } = require('../utils/constants');

const corsOrigins = (process.env.CORS_ORIGINS || process.env.APP_BASE_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

for (const origin of CAPACITOR_RETURN_ORIGINS) {
  if (!corsOrigins.includes(origin)) corsOrigins.push(origin);
}

function defaultAppOrigin() {
  return (process.env.APP_BASE_URL || CAPACITOR_RETURN_ORIGINS[0] || '')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
}

function applyCors(app) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }));
}

module.exports = {
  corsOrigins,
  defaultAppOrigin,
  applyCors,
};
