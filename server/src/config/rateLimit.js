const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

function limiterKeyByUserOrIp(req) {
  const uid = req?.user?._id ? String(req.user._id) : '';
  if (uid) return `user:${uid}`;
  // Use the library helper so IPv6 addresses are normalised to a subnet
  // (raw req.ip would let each IPv6 address bypass the limit).
  return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
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
