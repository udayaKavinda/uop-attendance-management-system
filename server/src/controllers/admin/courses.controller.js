const mongoose = require('mongoose');
const courseService = require('../../services/course.service');
const lectureSessionService = require('../../services/lectureSession.service');
const attendanceService = require('../../services/attendance.service');
const { validateCreateCourseBody } = require('../../validators/course.validator');
const { parsePagination } = require('../../utils/pagination');

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const rawLecturerId = req.query.lecturerId;
  const lecturerId = typeof rawLecturerId === 'string' && mongoose.isValidObjectId(rawLecturerId)
    ? rawLecturerId
    : undefined;
  const result = await courseService.listForStaff(req.auth, pagination, lecturerId);
  if (Array.isArray(result)) return res.json({ items: result });
  return res.json(result);
}

async function create(req, res) {
  const validated = validateCreateCourseBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  try {
    const result = await courseService.createCourse(req.auth, validated);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, courses: result.created });
    }
    return res.json({ success: true, courses: result.courses });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'A course with this code and batch already exists' });
    }
    throw err;
  }
}

async function disable(req, res) {
  const result = await courseService.disableCourse(req.course);
  return res.json({ success: true, course: result.course });
}

async function enable(req, res) {
  const result = await courseService.enableCourse(req.course);
  return res.json({ success: true, course: result.course });
}

/** Owner or admin — wholesale reassignment (add and remove owners in one call). */
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
  disable,
  enable,
  assignLecturer,
  createSession,
  attendanceMatrix,
};
