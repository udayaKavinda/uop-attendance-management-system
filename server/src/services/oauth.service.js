const crypto = require('crypto');
const {
  CAPACITOR_RETURN_ORIGINS,
  NATIVE_OAUTH_RETURN_BASES,
  WEB_APP_MOUNT_PATH,
} = require('../utils/constants');
const { corsOrigins, defaultAppOrigin } = require('../config/cors');

/**
 * The iOS web client's own base. Same origin as this server (see
 * WEB_APP_MOUNT_PATH), so the OAuth callback's session cookie is first-party by
 * the time the browser lands back on the app.
 */
function webAppReturnBase() {
  const origin = publicAppOrigin();
  return origin ? `${origin}${WEB_APP_MOUNT_PATH}` : '';
}

function allowedOAuthReturnOrigins() {
  const bases = [...corsOrigins, ...CAPACITOR_RETURN_ORIGINS, ...NATIVE_OAUTH_RETURN_BASES];
  const webBase = webAppReturnBase();
  if (webBase) bases.push(webBase);
  return new Set(bases);
}

function pickOAuthReturnBase(req) {
  const allowed = allowedOAuthReturnOrigins();
  const requested = String(req.query.returnTo || '').trim().replace(/\/$/, '');
  if (requested && allowed.has(requested)) return requested;
  return defaultAppOrigin();
}

const oauthExchangeCodes = new Map();

function issueOAuthExchangeCode(userId) {
  const code = crypto.randomBytes(32).toString('hex');
  oauthExchangeCodes.set(code, {
    userId: String(userId),
    expires: Date.now() + 2 * 60 * 1000,
  });
  return code;
}

function consumeOAuthExchangeCode(code) {
  const entry = oauthExchangeCodes.get(code);
  if (!entry) return null;
  oauthExchangeCodes.delete(code);
  if (entry.expires < Date.now()) return null;
  return entry.userId;
}

const oauthExchangeSweep = setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of oauthExchangeCodes) {
    if (entry.expires < now) oauthExchangeCodes.delete(code);
  }
}, 5 * 60 * 1000);
if (typeof oauthExchangeSweep.unref === 'function') oauthExchangeSweep.unref();

/** The only paths redirectAfterOAuth ever appends to a native return base. */
const NATIVE_RETURN_PATHS = ['', '/', '/login/success'];
/** Exchange codes are 32 random bytes hex-encoded — see issueOAuthExchangeCode. */
const EXCHANGE_CODE_RE = /^[0-9a-f]{64}$/;

/**
 * Validates a native return target and breaks it into the pieces the bounce page
 * is allowed to re-emit, or returns null if anything about it is unexpected.
 *
 * Deliberately not the `startsWith` prefix test this used to be: that accepted
 * anything glued onto the end of the scheme, so both
 * `lk.ac.pdn.eng.attendance://oauth.evil.com/x` and
 * `lk.ac.pdn.eng.attendance://oauth</script><script>...` passed — the second of
 * which escaped the bounce page's inline script and executed on this origin.
 * Nothing from `raw` reaches the page now; the URL is rebuilt from these fields.
 */
function parseNativeReturnTarget(raw) {
  const target = String(raw || '');
  if (target.length > 512) return null;

  const queryAt = target.indexOf('?');
  const beforeQuery = queryAt === -1 ? target : target.slice(0, queryAt);

  // Split on the base rather than parsing as a URL: Node's URL parser does not
  // give a usable host/pathname split for arbitrary custom schemes.
  const base = NATIVE_OAUTH_RETURN_BASES.find(
    (b) => beforeQuery === b || beforeQuery.startsWith(`${b}/`),
  );
  if (!base) return null;
  const path = beforeQuery.slice(base.length);
  if (!NATIVE_RETURN_PATHS.includes(path)) return null;

  if (queryAt === -1) return { base, path, code: null, error: null };

  const params = new URLSearchParams(target.slice(queryAt + 1));
  let code = null;
  let error = null;
  for (const [name, value] of params) {
    // Every parameter is re-emitted from these validated fields, never copied
    // through, so an unknown one has nowhere to go: reject rather than drop it.
    if (name === 'code') {
      if (!EXCHANGE_CODE_RE.test(value)) return null;
      code = value;
    } else if (name === 'error') {
      if (!/^[a-z_]{1,32}$/.test(value)) return null;
      error = value;
    } else {
      return null;
    }
  }
  return { base, path, code, error };
}

/** Rebuilds the return URL from validated parts — never from the caller's string. */
function nativeReturnUrl({ base, path, code, error }) {
  const query = new URLSearchParams();
  if (error) query.set('error', error);
  if (code) query.set('code', code);
  const qs = query.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

function isCustomSchemeOAuthReturn(returnBase) {
  return NATIVE_OAUTH_RETURN_BASES.includes(returnBase)
    || (returnBase.includes('://') && !returnBase.startsWith('http://') && !returnBase.startsWith('https://'));
}

function publicAppOrigin() {
  return (process.env.APP_BASE_URL || '')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
}

function redirectAfterOAuth(res, returnBase, relativePath, userId) {
  const base = String(returnBase || '').replace(/\/$/, '');
  let target = `${base}${relativePath}`;

  if (isCustomSchemeOAuthReturn(base) && userId) {
    const code = issueOAuthExchangeCode(userId);
    const join = relativePath.includes('?') ? '&' : '?';
    target = `${base}${relativePath}${join}code=${encodeURIComponent(code)}`;
  }

  if (isCustomSchemeOAuthReturn(base)) {
    const appOrigin = publicAppOrigin();
    if (appOrigin) {
      return res.redirect(`${appOrigin}/auth/native-return?target=${encodeURIComponent(target)}`);
    }
  }

  return res.redirect(target);
}

/**
 * The bounce page that hands control back to the native app.
 *
 * Rebuilt from the parsed pieces rather than from the caller's string, and with
 * no inline script at all. The old version embedded the raw target inside a
 * `<script>` via JSON.stringify — which escapes quotes but not `</script>`, so a
 * crafted target closed the script element and the rest of it ran as markup.
 * That inline script is also the only reason this route had to relax CSP to
 * `script-src 'unsafe-inline'`; without it the route can run under a policy that
 * allows no script at all. A `<meta http-equiv="refresh">` does the redirect,
 * and the link remains as the manual fallback.
 */
function buildNativeReturnHtml(parsed) {
  const safeHref = nativeReturnUrl(parsed)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0; url=${safeHref}">
<title>Return to app</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem">
<p>Returning to UOP Attendance…</p>
<p><a id="open" href="${safeHref}">Tap here if you are not redirected</a></p>
</body></html>`;
}

module.exports = {
  webAppReturnBase,
  pickOAuthReturnBase,
  parseNativeReturnTarget,
  nativeReturnUrl,
  issueOAuthExchangeCode,
  consumeOAuthExchangeCode,
  redirectAfterOAuth,
  buildNativeReturnHtml,
  defaultAppOrigin,
};
