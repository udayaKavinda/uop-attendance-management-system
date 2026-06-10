const cors = require('cors');
const { CAPACITOR_RETURN_ORIGINS } = require('../utils/constants');

const corsOrigins = (process.env.FRONTEND_URL
  || process.env.APP_BASE_URL
  || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

for (const origin of CAPACITOR_RETURN_ORIGINS) {
  if (!corsOrigins.includes(origin)) corsOrigins.push(origin);
}

function defaultFrontendOrigin() {
  return (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:3000')
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
  defaultFrontendOrigin,
  applyCors,
};
