const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const ManualCode = require('../models/ManualCode');
const Person = require('../models/Person');
const bluetoothCode = require('./bluetoothCode.service');
const { invalidateActiveSessionCache } = require('./session.service');
const { validateLecturerIds } = require('../validators/course.validator');

/**
 * `pagination` omitted (or `hasLimit: false`) returns every matching course, as
 * before. Passed with `hasLimit: true`, returns a page instead — needed once an
 * installation has hundreds of courses so the admin/lecturer UI isn't loading
 * (and rendering) the entire table on every visit.
 */
async function listForStaff(auth, pagination, lecturerId) {
  // Admins may additionally scope to one lecturer (Courses-tab filter) so that
  // filter stays correct under pagination instead of only matching whatever
  // happens to be on the currently-loaded page. Non-admin staff are always
  // scoped to themselves regardless of what's passed here.
  const filter = auth.isAdmin
    ? (lecturerId ? { lecturers: lecturerId } : {})
    : { lecturers: auth.person._id };
  const query = Course.find(filter)
    .populate('lecturers', 'name email phone')
    .sort({ active: -1, code: 1, batch: 1 });
  if (!pagination || !pagination.hasLimit) return query;

  const { page, limit } = pagination;
  const [items, total] = await Promise.all([
    query.skip((page - 1) * limit).limit(limit),
    Course.countDocuments(filter),
  ]);
  return { items, total, page, limit, hasMore: page * limit < total };
}

/**
 * Creates one Course document per requested batch (all sharing code/name/owners).
 * Stops at the first batch that already exists — code+batch is unique — and
 * reports who owns it so the caller can be told who to ask for access. Any
 * batches already created before the collision are left in place (each batch is
 * an independent course row, so a partial create is a valid end state).
 */
async function createCourse(auth, { name, code, batches, lecturerIdsBody }) {
  let lecturerIdsToAssign;
  if (auth.isAdmin) {
    const validation = await validateLecturerIds(lecturerIdsBody);
    if (!validation.ok) return validation;
    lecturerIdsToAssign = validation.lecturerIds;
  } else {
    lecturerIdsToAssign = [String(auth.person._id)];
  }

  const created = [];
  for (const batch of batches) {
    const existing = await Course.findOne({ code, batch }).populate('lecturers', 'name email');
    if (existing) {
      const owners = (existing.lecturers || []).map((l) => l.name || l.email).filter(Boolean);
      const ownerText = owners.length ? ` — ask ${owners.join(', ')} for access` : '';
      return {
        ok: false,
        status: 400,
        error: `${code} (${batch}) already exists${ownerText}`,
        created,
      };
    }
    const course = await Course.create({
      name,
      code,
      batch,
      active: true,
      lecturers: lecturerIdsToAssign,
    });
    await course.populate('lecturers', 'name email phone');
    created.push(course);
  }
  return { ok: true, courses: created };
}

/** Hides the course (and everything under it) rather than destroying data. */
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

/** Admin-only: wholesale reassignment (can add AND remove owners). */
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

/**
 * Additive only: an existing owner (or admin) can add ONE more co-owner, but
 * can never remove an owner this way — removal stays admin-only via
 * `assignLecturers`, so a lecturer can't be griefed off their own course.
 */
async function addLecturer(course, lecturerId) {
  const id = String(lecturerId || '').trim();
  const lecturer = await Person.findOne({ _id: id, role: 'lecturer', deleted: false });
  if (!lecturer) return { ok: false, status: 400, error: 'Invalid lecturerId' };
  const already = (course.lecturers || []).some((l) => String(l) === id);
  if (!already) {
    course.lecturers.push(lecturer._id);
    await course.save();
  }
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
}

module.exports = {
  listForStaff,
  createCourse,
  disableCourse,
  enableCourse,
  assignLecturers,
  addLecturer,
};
