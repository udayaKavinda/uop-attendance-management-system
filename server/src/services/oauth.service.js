const crypto = require('crypto');
const {
  CAPACITOR_RETURN_ORIGINS,
  NATIVE_OAUTH_RETURN_BASES,
} = require('../utils/constants');
const { corsOrigins, defaultFrontendOrigin } = require('../config/cors');

function allowedOAuthReturnOrigins() {
  return new Set([...corsOrigins, ...CAPACITOR_RETURN_ORIGINS, ...NATIVE_OAUTH_RETURN_BASES]);
}

function pickOAuthReturnBase(req) {
  const allowed = allowedOAuthReturnOrigins();
  const requested = String(req.query.returnTo || '').trim().replace(/\/$/, '');
  if (requested && allowed.has(requested)) return requested;
  return defaultFrontendOrigin();
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

function isCustomSchemeOAuthReturn(returnBase) {
  return NATIVE_OAUTH_RETURN_BASES.includes(returnBase)
    || (returnBase.includes('://') && !returnBase.startsWith('http://') && !returnBase.startsWith('https://'));
}

function publicAppOrigin() {
  return (process.env.APP_BASE_URL || process.env.FRONTEND_URL || '')
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

function buildNativeReturnHtml(target) {
  const safeHref = target
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Return to app</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem">
<p>Returning to UOP Attendance…</p>
<p><a id="open" href="${safeHref}">Tap here if you are not redirected</a></p>
<script>
(function () {
  var url = ${JSON.stringify(target)};
  window.location.replace(url);
  setTimeout(function () { document.getElementById('open').click(); }, 300);
})();
</script>
</body></html>`;
}

module.exports = {
  pickOAuthReturnBase,
  issueOAuthExchangeCode,
  consumeOAuthExchangeCode,
  redirectAfterOAuth,
  buildNativeReturnHtml,
  defaultFrontendOrigin,
};
