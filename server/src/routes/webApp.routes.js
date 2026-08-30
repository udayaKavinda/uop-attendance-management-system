/**
 * Serves the built iOS web client (see web/) from this server's own origin.
 *
 * Same-origin is not a convenience here, it is the whole reason the client can
 * work at all: authentication is an httpOnly `attendance.sid` cookie, and Safari
 * blocks third-party cookies outright, so a client hosted anywhere else would be
 * signed out on every request. Mounting under WEB_APP_MOUNT_PATH also keeps the
 * existing top-level `/privacy` and `/delete` pages — and every `/api` and
 * `/auth` route — exactly where they were.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const DIST_DIR = path.resolve(__dirname, '../../../web/dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');

const router = express.Router();

/**
 * Only Vite's own output under /assets is content-hashed, so only that is safe
 * to cache immutably. Everything else copied verbatim from web/public — the
 * manifest, the icons — keeps a stable name across releases and would otherwise
 * be pinned for a year, and `index.html` must never be cached at all or a
 * student keeps booting yesterday's bundle against today's API.
 */
router.use(express.static(DIST_DIR, {
  index: false,
  fallthrough: true,
  setHeaders(res, filePath) {
    const relative = path.relative(DIST_DIR, filePath).split(path.sep).join('/');
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (relative.startsWith('assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

/**
 * SPA fallback: `/app/login/success` and friends are client-side routes with no
 * file behind them, so every unmatched GET returns the same document.
 *
 * A missing build answers 503 rather than throwing — the server is deployed from
 * the same commit as the web client, and an API-only deploy (or a developer who
 * has not run `npm --prefix web run build`) must not take the whole process down.
 */
router.get(/.*/, (req, res) => {
  if (!fs.existsSync(INDEX_HTML)) {
    return res
      .status(503)
      .type('text/plain')
      .send('The web client has not been built. Run: npm --prefix web ci && npm --prefix web run build');
  }
  res.setHeader('Cache-Control', 'no-cache');
  return res.sendFile(INDEX_HTML);
});

module.exports = router;
