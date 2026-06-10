const lecturerService = require('../../services/lecturer.service');
const {
  validateLecturerCreateBody,
  validateLecturerUpdateBody,
} = require('../../validators/lecturer.validator');

async function list(req, res) {
  const items = await lecturerService.listLecturers(req.query.q);
  return res.json({ items });
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

async function update(req, res) {
  const validated = validateLecturerUpdateBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  try {
    const result = await lecturerService.updateLecturer(req.params.id, validated);
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

module.exports = { list, create, update, remove };
