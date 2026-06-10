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
const { csrf, testAuth, errorHandler } = require('./middlewares');

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

app.use(csrf);
registerRoutes(app);
app.use(errorHandler);

module.exports = app;
