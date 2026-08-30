/** Shared application constants (env-independent). */

const BOOTSTRAP_ADMIN_EMAIL = 'feats.eng.admin@gmail.com';
const CAPACITOR_RETURN_ORIGINS = ['https://localhost'];
/**
 * Where the iOS web client is served from — deliberately the SAME origin as the
 * API. Safari blocks third-party cookies outright, so a separately-hosted web
 * client could never hold the `attendance.sid` session cookie this server issues.
 * Mounting it under a path keeps `/privacy`, `/delete`, `/api/*` and `/auth/*`
 * exactly where they are.
 */
const WEB_APP_MOUNT_PATH = '/app';
const NATIVE_OAUTH_RETURN_BASES = ['lk.ac.pdn.eng.attendance://oauth', 'lk.uop.attendance://oauth'];
const SESSION_RESOLVE_CACHE_TTL_MS = 5000;
/**
 * A broadcast with no token poll (heartbeat) for this long is considered dead:
 * students are rejected at read time and the sweep job flips `broadcasting` off.
 * The broadcaster polls every ~5s, so 30s means ~6 consecutive missed polls.
 */
const BROADCAST_STALE_MS = 30_000;

module.exports = {
  BOOTSTRAP_ADMIN_EMAIL,
  CAPACITOR_RETURN_ORIGINS,
  WEB_APP_MOUNT_PATH,
  NATIVE_OAUTH_RETURN_BASES,
  SESSION_RESOLVE_CACHE_TTL_MS,
  BROADCAST_STALE_MS,
};
