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

module.exports = {
  isProd,
  timeZone: process.env.TZ,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/attendance',
  port: Number(process.env.PORT) || 5000,
  // SESSION_SECRET is guaranteed set in production by the process.exit guard above.
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret',
};
