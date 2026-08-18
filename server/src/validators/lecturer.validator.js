function validateLecturerCreateBody(body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone ?? '').trim();
  if (!name || !email) return { ok: false, status: 400, error: 'name and email are required' };
  return { ok: true, name, email, phone };
}

module.exports = {
  validateLecturerCreateBody,
};
