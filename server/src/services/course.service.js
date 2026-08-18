const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');
const ManualCode = require('../models/ManualCode');
const bluetoothCode = require('./bluetoothCode.service');
const { invalidateActiveSessionCache } = require('./session.service');
const { validateLecturerIds } = require('../validators/course.validator');

async function listActiveForStudent() {
  const items = await Course.find({ active: true }).sort({ code: 1, batch: 1 });
  return items.map((c) => ({
    _id: c._id,
    code: c.code,
    batch: c.batch,
    name: c.name,
  }));
}

async function listForStaff(auth) {
  const filter = auth.isAdmin ? {} : { lecturers: auth.person._id };
  return Course.find(filter).populate('lecturers', 'name email phone').sort({ code: 1, batch: 1 });
}

async function createCourse(auth, { name, code, batch, lecturerIdsBody }) {
  let lecturerIdsToAssign;
  if (auth.isAdmin) {
    const validation = await validateLecturerIds(lecturerIdsBody);
    if (!validation.ok) return validation;
    lecturerIdsToAssign = validation.lecturerIds;
  } else {
    lecturerIdsToAssign = [String(auth.person._id)];
  }
  const existing = await Course.findOne({ code, batch });
  if (existing) return { ok: false, status: 400, error: 'A course with this code and batch already exists' };
  const course = await Course.create({
    name,
    code,
    batch,
    active: true,
    lecturers: lecturerIdsToAssign,
  });
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
}

async function deleteCourse(course) {
  const sessionIds = await LectureSession.find({ course: course._id }).distinct('_id');
  await Attendance.deleteMany({ course: course._id });
  await ManualCode.deleteMany({ session: { $in: sessionIds } });
  await LectureSession.deleteMany({ course: course._id });
  await Course.deleteOne({ _id: course._id });
  await Promise.all(sessionIds.map((id) => bluetoothCode.removeToken(String(id))));
  invalidateActiveSessionCache(course._id);
  return { ok: true };
}

async function disableCourse(course) {
  const sessionIds = await LectureSession.find({ course: course._id }).distinct('_id');
  course.active = false;
  await course.save();
  await LectureSession.updateMany(
    { course: course._id },
    { $set: { active: false, broadcasting: false, lastBroadcastSeenAt: null } },
  );
  await ManualCode.deleteMany({ session: { $in: sessionIds } });
  await Promise.all(sessionIds.map((id) => bluetoothCode.removeToken(String(id))));
  invalidateActiveSessionCache(course._id);
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
}

async function enableCourse(course) {
  course.active = true;
  await course.save();
  invalidateActiveSessionCache(course._id);
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
}

async function assignLecturers(courseId, lecturerIds) {
  const validation = await validateLecturerIds(lecturerIds);
  if (!validation.ok) return validation;
  const course = await Course.findById(courseId);
  if (!course) return { ok: false, status: 404, error: 'Course not found' };
  course.lecturers = validation.lecturerIds;
  await course.save();
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
}

module.exports = {
  listActiveForStudent,
  listForStaff,
  createCourse,
  deleteCourse,
  disableCourse,
  enableCourse,
  assignLecturers,
};
