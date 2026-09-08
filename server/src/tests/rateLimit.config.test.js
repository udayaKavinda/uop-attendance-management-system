'use strict';

/**
 * limiterKeyByUserOrIp's IP-fallback branch used to call express-rate-limit's
 * `ipKeyGenerator` helper, which does not exist in the pinned v7 line (added
 * only in v8; package.json requires ^7.0.0) — every call with no
 * authenticated `req.user` threw TypeError: ipKeyGenerator is not a
 * function.
 *
 * Currently unreachable in production: both limiters that use this key
 * function (studentRecordLimiter, helpCodeLimiter) are only ever mounted
 * behind requireStudent, which guarantees req.user is set before they run —
 * confirmed via server/src/routes/attendance.routes.js and
 * middlewares/requireAuth.js. Still a live landmine for the next route that
 * reuses it pre-auth, so it's fixed and pinned down here rather than left
 * as a "can't happen" the moment a call actually reaches this branch.
 */
const { limiterKeyByUserOrIp } = require('../config/rateLimit');

describe('limiterKeyByUserOrIp', () => {
  test('keys an authenticated request by user id, never by IP', () => {
    const req = { user: { _id: 'stu-1' }, ip: '203.0.113.7' };
    expect(limiterKeyByUserOrIp(req)).toBe('user:stu-1');
  });

  test('falls back to IP without throwing when there is no authenticated user', () => {
    expect(() => limiterKeyByUserOrIp({ user: null, ip: '203.0.113.7' })).not.toThrow();
    expect(limiterKeyByUserOrIp({ user: null, ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
  });

  test('normalizes an IPv6 address to a /64-equivalent prefix rather than the exact address', () => {
    const key = limiterKeyByUserOrIp({ user: null, ip: '2001:db8:abcd:1234:5678:90ab:cdef:1111' });
    expect(key).toBe('ip:2001:db8:abcd:1234');
    // A different host on the same /64 collapses to the same key.
    const sameSubnet = limiterKeyByUserOrIp({ user: null, ip: '2001:db8:abcd:1234:aaaa:bbbb:cccc:dddd' });
    expect(sameSubnet).toBe(key);
  });

  test('never crashes when req.ip itself is missing', () => {
    expect(() => limiterKeyByUserOrIp({})).not.toThrow();
    expect(limiterKeyByUserOrIp({})).toBe('ip:unknown');
  });
});
