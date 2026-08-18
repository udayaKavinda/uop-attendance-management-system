const Course = require('../models/Course');

/** Uses Passport-deserialized req.user — avoids a redundant Person.findById per request. */
function getPersonFromRequest(req) {
  if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }
  const person = req.user;
  if (!person) return { ok: false, status: 401, message: 'User not found' };
  return { ok: true, person };
}

/** Staff API authorization: derived from Passport session (Google OAuth), not client headers. */
function authorizeStaff(person) {
  const role = person.role;
  if (role !== 'admin' && role !== 'lecturer') {
    return { ok: false, status: 403, message: 'Staff access required' };
  }
  if (role === 'lecturer' && person.deleted) {
    return { ok: false, status: 403, message: 'Lecturer access revoked' };
  }
  return { ok: true, person, isAdmin: role === 'admin' };
}

function authorizeAdmin(person) {
  const staff = authorizeStaff(person);
  if (!staff.ok) return staff;
  if (!staff.isAdmin) return { ok: false, status: 403, message: 'Admin access required' };
  return { ok: true, person: staff.person, isAdmin: true };
}

/** Student lecture attendance: session only, role must be student. */
function authorizeStudent(person) {
  const role = person.role;
  if (role !== 'student') {
    return { ok: false, status: 403, message: 'Only student accounts can use lecture attendance' };
  }
  if (person.deleted) {
    return { ok: false, status: 403, message: 'Account inactive' };
  }
  return { ok: true, person };
}

async function assertCourseAccess(person, isAdmin, courseId) {
  const course = await Course.findById(courseId);
  if (!course) return { ok: false, status: 404, message: 'Course not found' };
  if (isAdmin) return { ok: true, course };
  if (person.role !== 'lecturer') return { ok: false, status: 403, message: 'Not allowed for this course' };
  const courseLecturerIds = Array.isArray(course.lecturers) ? course.lecturers.map((id) => String(id)) : [];
  if (!courseLecturerIds.includes(String(person._id))) {
    return { ok: false, status: 403, message: 'Not allowed for this course' };
  }
  return { ok: true, course };
}

async function staffSessionMatch(person, isAdmin) {
  if (isAdmin) return {};
  if (person.role !== 'lecturer') return { course: { $in: [] } };
  const ids = await Course.find({ lecturers: person._id }).distinct('_id');
  return { course: { $in: ids } };
}

module.exports = {
  getPersonFromRequest,
  authorizeStaff,
  authorizeAdmin,
  authorizeStudent,
  assertCourseAccess,
  staffSessionMatch,
};
