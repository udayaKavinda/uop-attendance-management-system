const { applyCors, corsOrigins, defaultAppOrigin } = require('./cors');
const { applySecurity } = require('./security');
const { applySession } = require('./session');
const { applyPassport, isGoogleOAuthConfigured } = require('./passport');
const { studentRecordLimiter, oauthLimiter } = require('./rateLimit');
const { connectDatabase, syncAllIndexes, closeDatabase } = require('./database');

module.exports = {
  applyCors,
  applySecurity,
  applySession,
  applyPassport,
  isGoogleOAuthConfigured,
  corsOrigins,
  defaultAppOrigin,
  studentRecordLimiter,
  oauthLimiter,
  connectDatabase,
  syncAllIndexes,
  closeDatabase,
};
