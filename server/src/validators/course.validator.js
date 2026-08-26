const Person = require('../models/Person');
const { normalizeLecturerIds } = require('../utils/lecturerIds');

const CODE_RE = /^[A-Z0-9]+$/;
const BATCH_RE = /^E\d{2}$/;

function validateCreateCourseBody(body) {
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  const rawBatches = Array.isArray(body.batches)
    ? body.batches
    : (body.batch !== undefined ? [body.batch] : []);
  const batches = [...new Set(rawBatches.map((b) => String(b ?? '').trim().toUpperCase()))];
  const lecturerIdsBody = normalizeLecturerIds(body.lecturerIds);

  if (!code || !name) return { ok: false, status: 400, error: 'name and code are required' };
  if (!CODE_RE.test(code)) return { ok: false, status: 400, error: 'code must contain only capital letters and numbers' };
  if (batches.length === 0) return { ok: false, status: 400, error: 'At least one batch is required' };
  for (const batch of batches) {
    if (!BATCH_RE.test(batch)) {
      return { ok: false, status: 400, error: `batch "${batch}" must be an E followed by two digits, e.g. E23` };
    }
  }
  return { ok: true, name, code, batches, lecturerIdsBody };
}

async function validateLecturerIds(lecturerIds) {
  const ids = normalizeLecturerIds(lecturerIds);
  if (ids.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'lecturerIds must include at least 1 lecturer',
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
