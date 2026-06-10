const { isProd } = require('../config/env');

/**
 * Classifies common Mongo/Mongoose errors so handlers don't return 500 for client mistakes
 * and don't leak driver internals.
 */
function respondError(res, err, fallbackStatus = 500) {
  if (err && err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid identifier' });
  }
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Invalid input' });
  }
  if (err && (err.code === 11000 || err.code === 11001)) {
    return res.status(409).json({ error: 'Duplicate value' });
  }
  return res.status(fallbackStatus).json({ error: isProd ? 'Internal server error' : (err?.message || 'Internal server error') });
}

/** Express 4-arg error middleware — catches errors forwarded via next(err). */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  return respondError(res, err);
}

module.exports = { respondError, errorHandler };
