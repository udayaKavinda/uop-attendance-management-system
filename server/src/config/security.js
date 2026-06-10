const helmet = require('helmet');
const { isProd } = require('./env');

// Content Security Policy: production-only enforcement (CRA dev uses `eval` for
// source maps, which CSP would block). Allow-list is built from the actual
// external origins this app loads — see README "Content Security Policy".
const cspExtraConnect = String(process.env.CSP_EXTRA_CONNECT_SRC || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const cspReportOnly = String(process.env.CSP_REPORT_ONLY || '').toLowerCase() === '1'
  || String(process.env.CSP_REPORT_ONLY || '').toLowerCase() === 'true';
const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'", ...cspExtraConnect],
  frameAncestors: ["'none'"],
  formAction: ["'self'", 'https://accounts.google.com'],
  workerSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
  upgradeInsecureRequests: [],
};

function applySecurity(app) {
  app.use(helmet({
    // Enforce CSP in production; report-only in dev so regressions surface early
    // without breaking CRA's eval-based source maps.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives,
      reportOnly: isProd ? cspReportOnly : true,
    },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
}

module.exports = { applySecurity };
