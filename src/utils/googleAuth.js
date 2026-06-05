import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/** Capacitor WebView origin — used for API CORS only, not OAuth redirect. */
export const CAPACITOR_WEB_ORIGIN = 'https://localhost';

/**
 * Custom scheme OAuth return target. Android cannot render this inside the
 * in-app browser tab, so the OS hands off to the native app instead.
 */
export const NATIVE_OAUTH_RETURN_BASE = 'lk.uop.attendance://oauth';

export function apiBaseForAuth() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== 'undefined' && window.location.port === '3000') return 'http://localhost:5000';
  return '';
}

export function isNativeOAuthReturnUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'lk.uop.attendance:' && parsed.host === 'oauth';
  } catch {
    return false;
  }
}

export function pathFromOAuthReturnUrl(url) {
  const parsed = new URL(url);
  const path = parsed.pathname || '/';
  return `${path}${parsed.search}${parsed.hash}`;
}

/**
 * Start Google OAuth. On native Android, opens a system browser tab and returns
 * to the app via lk.uop.attendance://oauth deep link after the server callback.
 */
export async function startGoogleLogin() {
  const base = apiBaseForAuth().replace(/\/$/, '');
  if (!base) {
    throw new Error('API base URL is not configured. Set REACT_APP_API_BASE in .env and rebuild the app.');
  }

  if (Capacitor.isNativePlatform()) {
    const returnTo = encodeURIComponent(NATIVE_OAUTH_RETURN_BASE);
    await Browser.open({ url: `${base}/auth/google?returnTo=${returnTo}` });
    return;
  }

  window.location.href = `${base}/auth/google`;
}
