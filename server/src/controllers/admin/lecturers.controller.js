const lecturerService = require('../../services/lecturer.service');
const { validateLecturerCreateBody } = require('../../validators/lecturer.validator');
const { parsePagination } = require('../../utils/pagination');

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const result = await lecturerService.listLecturers(req.query.q, pagination);
  if (Array.isArray(result)) return res.json({ items: result });
  return res.json(result);
}

async function create(req, res) {
  const validated = validateLecturerCreateBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  try {
    const result = await lecturerService.createOrUpdateLecturer(validated);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ success: true, lecturer: result.lecturer });
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ error: 'Email already registered' });
    throw err;
  }
}

async function remove(req, res) {
  const result = await lecturerService.deleteLecturer(req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true });
}

module.exports = { list, create, remove };
