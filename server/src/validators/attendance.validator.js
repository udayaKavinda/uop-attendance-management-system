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

function validateBluetoothAttendanceBody(body) {
  const { courseId, token } = body || {};
  const id = String(courseId || '').trim();
  if (!mongoose.isValidObjectId(id)) {
    return { ok: false, status: 400, error: 'Invalid courseId' };
  }
  const tokenResult = validateBluetoothToken(token);
  if (!tokenResult.ok) return tokenResult;
  return { ok: true, courseId: id, token: tokenResult.token };
}

module.exports = {
  validateCourseId,
  validateBluetoothToken,
  validateBluetoothAttendanceBody,
};
