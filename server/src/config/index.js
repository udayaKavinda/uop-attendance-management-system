const { applyCors, corsOrigins, defaultFrontendOrigin } = require('./cors');
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
  defaultFrontendOrigin,
  studentRecordLimiter,
  oauthLimiter,
  connectDatabase,
  syncAllIndexes,
  closeDatabase,
};
