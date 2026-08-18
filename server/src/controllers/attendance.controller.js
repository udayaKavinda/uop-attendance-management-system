const attendanceService = require('../services/attendance.service');
const {
  validateCourseId, validateSessionIdQuery, validateUnifiedAttendanceBody,
} = require('../validators/attendance.validator');
const { validateManualCodeAttendanceBody } = require('../validators/manualCode.validator');

async function status(req, res) {
  const validated = validateCourseId(req.query.courseId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const data = await attendanceService.getAttendanceStatus(req.auth.person._id, validated.courseId);
  return res.json(data);
}

/** Legacy alias, kept for already-installed app versions — see recordUnified. */
async function recordManualCode(req, res) {
  const validated = validateManualCodeAttendanceBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceService.recordManualCodeAttendance(
    req.auth.person._id,
    validated.courseId,
    validated.code,
  );
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({
    success: true,
    attendance: result.attendance,
    ...(result.duplicate ? { duplicate: true } : {}),
  });
}

/**
 * Unified submission: exactly one of token (BLE) / fix (GPS) / code (manual).
 * `status: "pending"` (GPS only) means "not yet accepted, keep streaming fixes" —
 * it is not an error; the client's own 90s window is what eventually gives up.
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
  if (result.pending) return res.json({ status: 'pending' });
  return res.json({
    status: 'accepted',
    attendance: result.attendance,
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

module.exports = {
  status, recordManualCode, recordUnified, seedToken,
};
