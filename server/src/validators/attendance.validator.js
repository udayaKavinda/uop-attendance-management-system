const mongoose = require('mongoose');

function validateCourseId(courseId) {
  const id = String(courseId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'courseId query parameter is required' };
  if (!mongoose.isValidObjectId(id)) return { ok: false, status: 400, error: 'Invalid courseId' };
  return { ok: true, courseId: id };
}

function validateBluetoothToken(token) {
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{16}$/i.test(token.trim())) {
    return { ok: false, status: 400, error: 'Invalid Bluetooth token' };
  }
  return { ok: true, token: token.trim().toLowerCase() };
}

/**
 * Deliberately rejects anything that is not already a JSON number rather than
 * coercing. `Number(null)` is 0 — a valid latitude — so a client that omitted a
 * field, or sent null, used to be accepted as a fix at 0N 0E instead of being
 * told what was wrong. Strings are refused for the same reason: silent coercion
 * turns a client bug into a mysterious "not verified" 90 seconds later.
 */
function validateGpsFix(fix) {
  if (!fix || typeof fix !== 'object' || Array.isArray(fix)) {
    return { ok: false, status: 400, error: 'Invalid fix' };
  }
  const { lat, lng, accuracy } = fix;
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof accuracy !== 'number') {
    return { ok: false, status: 400, error: 'fix.lat, fix.lng and fix.accuracy must be numbers' };
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, status: 400, error: 'Invalid fix.lat' };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, status: 400, error: 'Invalid fix.lng' };
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000) {
    return { ok: false, status: 400, error: 'Invalid fix.accuracy' };
  }
  return { ok: true, fix: { lat, lng, accuracy } };
}

/**
 * Body for the unified `POST /api/attendance`: exactly one of `token` (BLE),
 * `fix` (GPS), or `code` (manual) must be present.
 */
function validateUnifiedAttendanceBody(body) {
  const {
    courseId, token, fix, code, canAdvertise,
  } = body || {};
  const id = String(courseId || '').trim();
  if (!mongoose.isValidObjectId(id)) {
    return { ok: false, status: 400, error: 'Invalid courseId' };
  }

  const present = [token, fix, code].filter((v) => v !== undefined && v !== null).length;
  if (present !== 1) {
    return { ok: false, status: 400, error: 'Exactly one of token, fix, or code is required' };
  }

  const result = { courseId: id, canAdvertise: Boolean(canAdvertise) };
  if (token !== undefined) {
    const tokenResult = validateBluetoothToken(token);
    if (!tokenResult.ok) return tokenResult;
    result.token = tokenResult.token;
  } else if (fix !== undefined) {
    const fixResult = validateGpsFix(fix);
    if (!fixResult.ok) return fixResult;
    result.fix = fixResult.fix;
  } else {
    const normalized = String(code || '').trim();
    if (!/^[0-9]{8}$/.test(normalized)) {
      return { ok: false, status: 400, error: 'Invalid attendance code' };
    }
    result.code = normalized;
  }
  return { ok: true, ...result };
}

function validateSessionIdQuery(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'sessionId query parameter is required' };
  if (!mongoose.isValidObjectId(id)) return { ok: false, status: 400, error: 'Invalid sessionId' };
  return { ok: true, sessionId: id };
}

module.exports = {
  validateCourseId,
  validateSessionIdQuery,
  validateBluetoothToken,
  validateGpsFix,
  validateUnifiedAttendanceBody,
};
