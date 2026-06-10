/** Shared application constants (env-independent). */

const MAX_COURSE_LECTURERS = 5;
const BOOTSTRAP_ADMIN_EMAIL = 'udayakavindadev@gmail.com';
const CAPACITOR_RETURN_ORIGINS = ['https://localhost'];
const NATIVE_OAUTH_RETURN_BASES = ['lk.ac.pdn.eng.attendance://oauth', 'lk.uop.attendance://oauth'];
const SESSION_RESOLVE_CACHE_TTL_MS = 5000;
/**
 * A broadcast with no token poll (heartbeat) for this long is considered dead:
 * students are rejected at read time and the sweep job flips `broadcasting` off.
 * The broadcaster polls every ~5s, so 30s means ~6 consecutive missed polls.
 */
const BROADCAST_STALE_MS = 30_000;

module.exports = {
  MAX_COURSE_LECTURERS,
  BOOTSTRAP_ADMIN_EMAIL,
  CAPACITOR_RETURN_ORIGINS,
  NATIVE_OAUTH_RETURN_BASES,
  SESSION_RESOLVE_CACHE_TTL_MS,
  BROADCAST_STALE_MS,
};
