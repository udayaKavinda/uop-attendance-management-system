require('dotenv').config();

// Every schedule/date comparison is intentionally local to the Peradeniya campus.
// Set a safe project default so a missing host-level TZ can never shift sessions.
process.env.TZ = process.env.TZ || 'Asia/Colombo';
try {
  new Intl.DateTimeFormat('en-US', { timeZone: process.env.TZ }).format();
} catch (_err) {
  console.error(`FATAL: TZ is not a valid IANA time zone: ${process.env.TZ}`);
  process.exit(1);
}

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}

// BLE payload secret. Falls back to a built-in value so the app runs with zero
// extra configuration in development; required in production to prevent token forgery.
if (isProd && !process.env.BLE_SECRET) {
  console.error('FATAL: BLE_SECRET must be set in production.');
  process.exit(1);
}
const BLE_SECRET = process.env.BLE_SECRET || 'uop-ble-dev-secret-change-me';

module.exports = {
  isProd,
  BLE_SECRET,
  timeZone: process.env.TZ,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/attendance',
  port: Number(process.env.PORT) || 5000,
  // SESSION_SECRET is guaranteed set in production by the process.exit guard above.
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret',
};
