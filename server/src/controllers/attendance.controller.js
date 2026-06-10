const attendanceService = require('../services/attendance.service');
const { validateCourseId } = require('../validators/attendance.validator');

async function status(req, res) {
  const validated = validateCourseId(req.query.courseId);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const data = await attendanceService.getAttendanceStatus(req.auth.person._id, validated.courseId);
  return res.json(data);
}

module.exports = { status };
