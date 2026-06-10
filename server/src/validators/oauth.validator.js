function validateExchangeCode(body) {
  const code = String(body?.code || '').trim();
  if (!code) return { ok: false, status: 400, error: 'Missing code' };
  return { ok: true, code };
}

module.exports = { validateExchangeCode };
