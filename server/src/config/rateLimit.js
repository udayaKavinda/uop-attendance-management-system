const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

function limiterKeyByUserOrIp(req) {
  const uid = req?.user?._id ? String(req.user._id) : '';
  if (uid) return `user:${uid}`;
  // Use the library helper so IPv6 addresses are normalised to a subnet
  // (raw req.ip would let each IPv6 address bypass the limit).
  return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

/**
 * Attendance submissions, per student per minute.
 *
 * 60 was too tight to be a safety net and tight enough to be a bug: one 90 s
 * check-in streams a GPS fix every 3 s (~30 requests), so two attempts filled
 * the whole quota and a third — the one a student in a weak-signal room actually
 * needs — was refused as abuse. Measured: 429 at the 61st submission.
 *
 * 180 leaves room for roughly six honest attempts a minute while still bounding
 * a runaway client. It is deliberately NOT the brute-force control: the only
 * input worth guessing is the 8-digit code, and that has its own much tighter
 * limiter below.
 */
const studentRecordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  keyGenerator: limiterKeyByUserOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many check-in attempts. Wait a minute, then try again.' },
});

/**
 * Code submissions only, per student. The code is an 8-digit value (10^8
 * keyspace) and the sole guessable secret in the system, so it gets its own
 * budget that streaming GPS fixes can no longer consume. 10/min makes a blind
 * guess hopeless while leaving a student who mistypes plenty of room.
 *
 * Applied by a small router-level wrapper rather than to the whole route,
 * because only one of the three submission shapes on POST /api/attendance is
 * a code — see limitHelpCode in routes/attendance.routes.js.
 */
const helpCodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: limiterKeyByUserOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Wait a minute, then ask your lecturer again.' },
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
  helpCodeLimiter,
  oauthLimiter,
  limiterKeyByUserOrIp,
};
