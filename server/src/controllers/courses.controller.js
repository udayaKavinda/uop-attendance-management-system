const mongoose = require('mongoose');
const sessionService = require('../services/session.service');
const Course = require('../models/Course');
const Person = require('../models/Person');

async function listRunning(req, res) {
  const items = await sessionService.getRunningCoursesForStudent();
  return res.json({ items });
}

/** GET /api/courses/catalog — every unarchived course, campus-wide, for the
 *  registration screen. Unlike /courses/running this ignores session state
 *  entirely: a student registers ahead of a lecture actually starting. */
async function listCatalog(req, res) {
  const courses = await Course.find({ active: true })
    .select('code name batch')
    .sort({ code: 1, batch: 1 });
  const items = courses.map((c) => ({ _id: c._id, code: c.code, name: c.name, batch: c.batch }));
  return res.json({ items });
}

async function listRegistered(req, res) {
  const items = (req.auth.person.registeredCourses || []).map((id) => String(id));
  return res.json({ items });
}

async function registerCourse(req, res) {
  const { courseId } = req.params;
  if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ error: 'Invalid course id' });
  const course = await Course.findOne({ _id: courseId, active: true }).select('_id');
  if (!course) return res.status(404).json({ error: 'Course not found' });
  await Person.updateOne(
    { _id: req.auth.person._id },
    { $addToSet: { registeredCourses: course._id } },
  );
  return res.json({ success: true });
}

async function unregisterCourse(req, res) {
  const { courseId } = req.params;
  if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ error: 'Invalid course id' });
  await Person.updateOne(
    { _id: req.auth.person._id },
    { $pull: { registeredCourses: courseId } },
  );
  return res.json({ success: true });
}

module.exports = { listRunning, listCatalog, listRegistered, registerCourse, unregisterCourse };
