function validateLecturerCreateBody(body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone ?? '').trim();
  if (!name || !email) return { ok: false, status: 400, error: 'name and email are required' };
  return { ok: true, name, email, phone };
}

function validateLecturerUpdateBody(body) {
  const { name, email, phone, active } = body || {};
  if (email !== undefined) {
    const next = String(email).trim().toLowerCase();
    if (!next) return { ok: false, status: 400, error: 'email is required' };
  }
  return {
    ok: true,
    name: name !== undefined ? String(name).trim() : undefined,
    email: email !== undefined ? String(email).trim().toLowerCase() : undefined,
    phone: phone !== undefined ? String(phone).trim() : undefined,
    active: active !== undefined ? Boolean(active) : undefined,
  };
}

module.exports = {
  validateLecturerCreateBody,
  validateLecturerUpdateBody,
};
