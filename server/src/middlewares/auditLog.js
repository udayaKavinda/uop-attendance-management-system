const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

/**
 * Records staff/admin mutations and every rejected auth attempt into the
 * `auditlogs` collection.
 *
 * Mounted once, globally, and it decides for itself what is worth keeping —
 * putting the decision here rather than in each controller is the only way the
 * record can be complete, since a route added later is covered automatically.
 *
 * Writes happen after the response is finished, so a slow or failing audit write
 * can never delay or break the request that produced it. A failed write is
 * logged and swallowed for the same reason: losing an audit row is bad, but
 * failing a lecturer's session delete because the audit write failed is worse.
 */

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** A 24-hex Mongo id sitting as a whole path segment. */
const ID_SEGMENT = /\/[0-9a-fA-F]{24}(?=\/|$)/g;

/**
 * The request path, taken from `originalUrl` rather than `req.path`.
 *
 * Express rewrites `req.url` while a request is inside a mounted sub-router
 * (`/api/admin/sessions/x` becomes `/sessions/x` under `app.use('/api/admin')`),
 * and the `finish` event fires while that rewrite is still in effect — so
 * reading `req.path` there saw a path that matched none of the rules below and
 * silently recorded nothing at all. `originalUrl` is never rewritten.
 */
function pathOf(req) {
  const url = req.originalUrl || req.url || '';
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

/** Whether this request is worth a permanent row. */
function isAudited(method, path, status) {
  if (!path.startsWith('/api/') && !path.startsWith('/auth/')) return false;

  // Every rejected attempt on an admin route, and every rejected mutation
  // anywhere — a burst of 403s on admin routes is exactly the pattern worth
  // being able to find later.
  if (status === 401 || status === 403) {
    return path.startsWith('/api/admin/') || MUTATING.has(method);
  }

  if (!MUTATING.has(method)) return false;

  // Successful mutations that change who can do what, or what the record says.
  if (path.startsWith('/api/admin/')) return true;
  // Sign-in, so a disputed record can be tied back to a session.
  if (path === '/api/auth/google-id-token' || path === '/api/auth/exchange-code') return true;
  return false;
}

/** The object acted on: the id segments of the path, e.g. a session or lecturer id. */
function targetFrom(path) {
  const ids = path.match(ID_SEGMENT);
  return ids ? ids.map((s) => s.slice(1)).join(',') : null;
}

/** `DELETE /api/admin/sessions/:id` — ids collapsed so rows group by action. */
function actionFrom(method, path) {
  return `${method} ${path.replace(ID_SEGMENT, '/:id')}`;
}

function auditLog(req, res, next) {
  // Captured now, not in the handler below: see pathOf.
  const path = pathOf(req);
  const { method } = req;
  const ip = req.ip || null;

  res.on('finish', () => {
    const status = res.statusCode;
    if (!isAudited(method, path, status)) return;

    // No connection means Mongoose would buffer this insert for bufferTimeoutMS
    // (10 s by default) and then fail anyway. During an outage that is one parked
    // timer per audited request for no gain, so drop the row instead of queueing
    // it — the same reasoning as the session store's connect timeout.
    if (mongoose.connection.readyState !== 1) return;

    // req.auth is set by the requireAuth guards, req.user by Passport. Both are
    // absent on a 401, which is itself the thing worth recording.
    const person = req.auth?.person || req.user || null;

    AuditLog.create({
      actor: person?._id || null,
      actorEmail: person?.email || null,
      actorRole: person?.role || null,
      action: actionFrom(method, path),
      target: targetFrom(path),
      status,
      outcome: status >= 400 ? 'denied' : 'allowed',
      ip,
    }).catch((err) => console.error('[audit]', err.message));
  });
  next();
}

module.exports = auditLog;
