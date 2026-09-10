// CSRF mitigation: require X-Requested-With on all mutating API routes.
// All browser fetch calls in api.js send this header; form-based cross-site
// POSTs cannot, preventing exploitation of SameSite=None session cookies.
function csrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (
    ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method) &&
    req.path.startsWith('/api/')
  ) {
    if (!req.headers['x-requested-with']) {
      return res.status(403).json({
        error: 'Request rejected by the cross-site request protection on this server. '
          + 'Sign in again from the app, and check that no proxy is stripping request headers.',
      });
    }
  }
  next();
}

module.exports = csrf;
