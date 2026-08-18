const courseService = require('../../services/course.service');
const lectureSessionService = require('../../services/lectureSession.service');
const attendanceService = require('../../services/attendance.service');
const { validateCreateCourseBody } = require('../../validators/course.validator');

async function list(req, res) {
  const items = await courseService.listForStaff(req.auth);
  return res.json({ items });
}

async function create(req, res) {
  const validated = validateCreateCourseBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  try {
    const result = await courseService.createCourse(req.auth, validated);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ success: true, course: result.course });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'A course with this code and batch already exists' });
    }
    throw err;
  }
}

async function remove(req, res) {
  await courseService.deleteCourse(req.course);
  return res.json({ success: true });
}

async function disable(req, res) {
  const result = await courseService.disableCourse(req.course);
  return res.json({ success: true, course: result.course });
}

async function enable(req, res) {
  const result = await courseService.enableCourse(req.course);
  return res.json({ success: true, course: result.course });
}

async function assignLecturer(req, res) {
  const result = await courseService.assignLecturers(req.params.courseId, req.body.lecturerIds);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true, course: result.course });
}

async function createSession(req, res) {
  const result = await lectureSessionService.createSession(req.course, req.body);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true, session: result.session });
}

async function attendanceMatrix(req, res) {
  const data = await attendanceService.getAttendanceMatrix(req.course);
  return res.json(data);
}

module.exports = {
  list,
  create,
  remove,
  disable,
  enable,
  assignLecturer,
  createSession,
  attendanceMatrix,
};
