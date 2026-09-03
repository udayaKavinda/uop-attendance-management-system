const { isProd } = require('../config/env');

/**
 * Classifies common Mongo/Mongoose errors so handlers don't return 500 for client mistakes
 * and don't leak driver internals.
 */
function respondError(res, err, fallbackStatus = 500) {
  // body-parser rejections are client mistakes, not server faults. Without this
  // a truncated JSON body or an oversized payload fell through to the 500 branch,
  // which told a caller the server had broken when the caller was at fault — and
  // filled error monitoring with false alarms. `err.status` is set by body-parser
  // itself (400 for entity.parse.failed, 413 for entity.too.large).
  if (err && err.type && String(err.type).startsWith('entity.')) {
    const status = Number(err.status) || 400;
    return res.status(status).json({
      error: status === 413 ? 'Request body is too large' : 'Malformed request body',
    });
  }
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
