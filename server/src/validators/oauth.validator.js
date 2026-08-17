function validateExchangeCode(body) {
  const code = String(body?.code || '').trim();
  if (!code) return { ok: false, status: 400, error: 'Missing code' };
  return { ok: true, code };
}

/** Google ID tokens are compact JWTs: three dot-separated base64url segments. */
function validateGoogleIdToken(body) {
  const idToken = String(body?.idToken || '').trim();
  if (!idToken) return { ok: false, status: 400, error: 'Missing idToken' };
  // Cheap shape check so obvious junk never reaches the Google verifier.
  if (idToken.length > 8192 || idToken.split('.').length !== 3) {
    return { ok: false, status: 400, error: 'Malformed idToken' };
  }
  return { ok: true, idToken };
}

module.exports = { validateExchangeCode, validateGoogleIdToken };
