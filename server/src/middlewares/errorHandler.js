const { isProd } = require('../config/env');

/**
 * Keeps only plain schema paths (`code`, `course.batch`) out of whatever the
 * driver handed us, so nothing unexpected can be reflected back to a caller.
 */
function fieldNames(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return list
    .map((p) => String(p == null ? '' : p))
    .filter((p) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(p));
}

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
  // Field NAMES only, never values: the names come from our own schemas and are
  // safe to echo, whereas the offending value is caller-supplied and may be
  // personal data. Naming the field is the difference between "Invalid input"
  // and a message the caller can act on.
  if (err && err.name === 'CastError') {
    return res.status(400).json({ error: fieldNames(err.path).length
      ? `The value supplied for "${err.path}" is not a valid identifier.`
      : 'One of the identifiers in this request is not valid.' });
  }
  if (err && err.name === 'ValidationError') {
    const fields = fieldNames(Object.keys(err.errors || {}));
    return res.status(400).json({ error: fields.length
      ? `These fields are missing or invalid: ${fields.join(', ')}.`
      : 'Some of the values in this request are missing or invalid.' });
  }
  if (err && (err.code === 11000 || err.code === 11001)) {
    const fields = fieldNames(Object.keys(err.keyValue || {}));
    return res.status(409).json({ error: fields.length
      ? `Another record already uses the same ${fields.join(' + ')}. Choose a different value.`
      : 'Another record already uses one of these values. Choose a different value.' });
  }
  return res.status(fallbackStatus).json({ error: isProd ? 'Internal server error' : (err?.message || 'Internal server error') });
}

/** Express 4-arg error middleware — catches errors forwarded via next(err). */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  return respondError(res, err);
}

module.exports = { respondError, errorHandler };
