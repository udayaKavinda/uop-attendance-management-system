/**
 * Express application factory.
 * No database connection or HTTP listen here — safe to require in tests via supertest.
 * dotenv is loaded once in server.js (and transitively via the config modules below).
 */
const express = require('express');
const {
  applySecurity,
  applyCors,
  applySession,
  applyPassport,
} = require('./config');
const registerRoutes = require('./routes');
const {
  csrf, testAuth, auditLog, errorHandler,
} = require('./middlewares');

const app = express();

app.set('trust proxy', 1);
applySecurity(app);
applyCors(app);
app.use(express.json({ limit: '256kb' }));
applySession(app);
applyPassport(app);

if (process.env.NODE_ENV === 'test') {
  app.use(testAuth);
}

// Before every guard, not just the routes: `csrf` answers 403 without calling
// next(), so an audit middleware mounted after it never registered its `finish`
// listener and CSRF rejections — exactly the burst pattern worth finding
// later — went unrecorded. Passport runs earlier, so req.user is still populated.
app.use(auditLog);
app.use(csrf);
registerRoutes(app);
app.use(errorHandler);

module.exports = app;
