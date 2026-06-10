const attendanceService = require('../services/attendance.service');
const { validateCourseId, validateBluetoothAttendanceBody } = require('../validators/attendance.validator');

async function target(req, res) {
  const validated = validateCourseId(req.query.courseId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceService.getBluetoothTarget(validated.courseId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ deviceName: result.deviceName });
}

async function recordAttendance(req, res) {
  const validated = validateBluetoothAttendanceBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceService.recordBluetoothAttendance(
    req.auth.person._id,
    validated.courseId,
    validated.token
  );
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({
    success: true,
    attendance: result.attendance,
    ...(result.duplicate ? { duplicate: true } : {}),
  });
}

module.exports = { target, recordAttendance };
