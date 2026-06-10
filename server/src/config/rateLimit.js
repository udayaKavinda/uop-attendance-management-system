const rateLimit = require('express-rate-limit');

function limiterKeyByUserOrIp(req) {
  const uid = req?.user?._id ? String(req.user._id) : '';
  if (uid) return `user:${uid}`;
  return `ip:${req.ip || 'unknown'}`;
}

const studentRecordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: limiterKeyByUserOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please slow down.' },
});

const oauthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts.' },
});

module.exports = {
  studentRecordLimiter,
  oauthLimiter,
  limiterKeyByUserOrIp,
};
