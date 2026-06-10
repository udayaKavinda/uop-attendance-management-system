const Person = require('../models/Person');
const { MAX_COURSE_LECTURERS } = require('../utils/constants');
const { normalizeLecturerIds } = require('../utils/lecturerIds');

function validateCreateCourseBody(body) {
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  const batch = String(body.batch ?? '').trim();
  const lecturerIdsBody = normalizeLecturerIds(body.lecturerIds);
  if (!code || !name) return { ok: false, status: 400, error: 'name and code are required' };
  if (!batch) return { ok: false, status: 400, error: 'batch is required' };
  return { ok: true, name, code, batch, lecturerIdsBody };
}

async function validateLecturerIds(lecturerIds) {
  const ids = normalizeLecturerIds(lecturerIds);
  if (ids.length === 0 || ids.length > MAX_COURSE_LECTURERS) {
    return {
      ok: false,
      status: 400,
      error: `lecturerIds must include 1 to ${MAX_COURSE_LECTURERS} lecturers`,
    };
  }
  const validLecturers = await Person.find({
    _id: { $in: ids },
    role: 'lecturer',
    deleted: false,
  }).select('_id');
  if (validLecturers.length !== ids.length) {
    return { ok: false, status: 400, error: 'Invalid lecturerIds' };
  }
  return { ok: true, lecturerIds: ids };
}

module.exports = {
  validateCreateCourseBody,
  validateLecturerIds,
};
