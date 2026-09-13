const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const ManualCode = require('../models/ManualCode');
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
    .sort({ active: -1, code: 1, batches: -1 });
  if (!pagination || !pagination.hasLimit) return query;

  const { page, limit } = pagination;
  const [items, total] = await Promise.all([
    query.skip((page - 1) * limit).limit(limit),
    Course.countDocuments(filter),
  ]);
  return { items, total, page, limit, hasMore: page * limit < total };
}

/**
 * Creates one course carrying every requested batch.
 *
 * The same code may be created again — that is how a course is offered to a new
 * intake — but never with a batch that an existing course of that code already
 * has, because a batch takes a course once. Every earlier offering is checked,
 * not only the latest, so a batch cannot be handed a course it sat years ago.
 * The refusal names the overlapping batches and those courses' owners, so the
 * caller knows exactly what collided and whom to ask. The unique (code, batch)
 * index still decides a race between concurrent creates; this check is for the
 * message, not the guarantee.
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

  const clashes = await Course.find({ code, batches: { $in: batches } })
    .populate('lecturers', 'name email');
  if (clashes.length > 0) {
    const taken = batches.filter((b) => clashes.some((c) => c.batches.includes(b)));
    const owners = [...new Set(clashes
      .flatMap((c) => (c.lecturers || []).map((l) => l.name || l.email))
      .filter(Boolean))];
    const ownerText = owners.length ? ` — ask ${owners.join(', ')} for access` : '';
    return {
      ok: false,
      status: 400,
      error: `${code} is already offered to ${taken.join(', ')}${ownerText}`,
    };
  }

  const course = await Course.create({
    name,
    code,
    batches,
    active: true,
    lecturers: lecturerIdsToAssign,
  });
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
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

/**
 * Re-activating is refused while the course has no owner, because the Course
 * schema forbids an active course with an empty `lecturers` list and the save
 * would otherwise throw a ValidationError. That reached the admin as the generic
 * "These fields are missing or invalid: lecturers." — naming a field they never
 * touched, on a button that says Enable, with no hint that the fix is to assign
 * someone. An archived course legitimately gets here: deleteLecturer is allowed
 * to strip the last owner precisely because an archived course runs nothing.
 */
async function enableCourse(course) {
  if (!Array.isArray(course.lecturers) || course.lecturers.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'This course has no assigned lecturer, so it cannot be re-activated. '
        + 'Assign at least one lecturer to it first, then activate it.',
    };
  }
  course.active = true;
  await course.save();
  invalidateActiveSessionCache(course._id);
  await course.populate('lecturers', 'name email phone');
  return { ok: true, course };
}

/**
 * Owner or admin — wholesale reassignment (add and remove owners in one call), gated by
 * `requireCourseAccess()` at the route so a lecturer may only do this on courses they
 * already own. The "at least 1 owner" rule in `validateLecturerIds` is what stops anyone
 * (owner or admin) from saving a course down to zero owners.
 */
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
  listForStaff,
  createCourse,
  disableCourse,
  enableCourse,
  assignLecturers,
};
