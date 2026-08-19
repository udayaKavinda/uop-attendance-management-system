const attendanceService = require('../services/attendance.service');
const {
  validateCourseId, validateSessionIdQuery, validateUnifiedAttendanceBody,
} = require('../validators/attendance.validator');

async function status(req, res) {
  const validated = validateCourseId(req.query.courseId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const data = await attendanceService.getAttendanceStatus(req.auth.person._id, validated.courseId);
  return res.json(data);
}

/** Whether a live BLE channel is worth scanning for; false also when BLE is globally off. */
async function bluetoothTarget(req, res) {
  const validated = validateCourseId(req.query.courseId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceService.getBluetoothTarget(validated.courseId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ available: result.available });
}

const RECORD_STATUS = {
  present: 'accepted',
  under_review: 'under_review',
  rejected: 'rejected',
};

/**
 * Unified submission: exactly one of token (BLE) / fix (GPS) / code (help).
 *
 * `status: "collecting"` means "no verdict yet, keep going" — and deliberately
 * covers BOTH "still gathering fixes" and "gathered enough, but you are not in a
 * passing band". The client must not be able to tell those apart, so it cannot
 * learn its distance band; the client's own 90s window is what gives up.
 */
async function recordUnified(req, res) {
  const validated = validateUnifiedAttendanceBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceService.recordAttendance(req.auth.person._id, validated.courseId, {
    token: validated.token,
    fix: validated.fix,
    code: validated.code,
    canAdvertise: validated.canAdvertise,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  if (result.collecting) return res.json({ status: 'collecting' });
  return res.json({
    status: RECORD_STATUS[result.attendance?.status] || 'accepted',
    ...(result.duplicate ? { duplicate: true } : {}),
    ...(result.seeding ? { seeding: result.seeding } : {}),
  });
}

/** Seeder re-fetch: current rotating seeder token; each call is also the heartbeat. */
async function seedToken(req, res) {
  const validated = validateSessionIdQuery(req.query.sessionId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceService.getSeedToken(req.auth.person._id, validated.sessionId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.data);
}

async function releaseSeedToken(req, res) {
  const validated = validateSessionIdQuery(req.query.sessionId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  await attendanceService.releaseSeedToken(req.auth.person._id, validated.sessionId);
  return res.json({ success: true });
}

module.exports = {
  status, bluetoothTarget, recordUnified, seedToken, releaseSeedToken,
};
