/** Test-only shim: injects req.user from x-test-user header when NODE_ENV=test. */
function testAuth(req, _res, next) {
  const raw = req.headers['x-test-user'];
  if (raw) {
    try {
      const u = JSON.parse(raw);
      req.user = u;
      req.isAuthenticated = () => true;
    } catch (_) {
      // ignore malformed header
    }
  }
  next();
}

module.exports = testAuth;
