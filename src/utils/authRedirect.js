/**
 * When the API returns 401, the browser may still hold a stale session cookie or
 * localStorage from before a server restart (in-memory sessions are lost).
 * Send the user to sign-in once; avoid loops on the login / OAuth-wait routes.
 */
let redirectScheduled = false;

export function notifySessionInvalid() {
  if (typeof window === 'undefined') return;
  if (redirectScheduled) return;

  const path = window.location.pathname;
  if (path === '/login/success') return;

  const params = new URLSearchParams(window.location.search);
  if (path === '/' && params.get('error') === 'session') return;

  redirectScheduled = true;
  try {
    localStorage.removeItem('student');
  } catch (_) {
    /* ignore */
  }

  window.location.replace(`${window.location.origin}/?error=session`);
}
