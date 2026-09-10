import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import type { Me } from '../api/types';

export type Session =
  | { state: 'loading' }
  | { state: 'loggedOut'; error?: string }
  | { state: 'loggedIn'; user: Me };

/** Where the OAuth callback sends the browser back to. Must match the server's
 *  webAppReturnBase() — origin + the app's mount path. */
const APP_BASE = `${window.location.origin}/app`;

/**
 * The path the server's OAuth callback lands on. It has no file behind it; the
 * SPA fallback serves the same document and this hook cleans the URL up.
 */
const LOGIN_SUCCESS_PATH = '/app/login/success';

/**
 * Browser sign-in can only answer with a redirect, so the server sends a reason
 * code (see oauthFailureQuery in auth.controller.js) rather than a message. The
 * copy lives here so it can be specific: "Sign-in failed. Please try again." was
 * flatly wrong for a rejected email domain, where retrying never succeeds.
 */
function signInFailureMessage(params: URLSearchParams): string | null {
  const code = params.get('error');
  if (code == null) return null;
  switch (code) {
    case 'domain': {
      const domain = params.get('domain');
      return domain
        ? `Only @${domain} email addresses can sign in. Use your university account, `
          + 'or ask an administrator to add you.'
        : 'That email address is not eligible to sign in. Use your university account, '
          + 'or ask an administrator to add you.';
    }
    case 'no_email':
      return 'Your Google account did not share an email address, which this app needs to identify you. '
        + 'Grant the email permission and try again.';
    case 'session':
      return 'Signed in with Google, but the session could not be created. Please try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

export function useSession() {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const refresh = useCallback(async () => {
    const res = await api.me();
    if (res.ok) {
      setSession({ state: 'loggedIn', user: res.data });
      return;
    }
    // 401 is the ordinary "not signed in yet" answer, not an error worth showing.
    setSession({
      state: 'loggedOut',
      error: res.status === 401 ? undefined : res.message,
    });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ state: 'loggedOut' }));

    const params = new URLSearchParams(window.location.search);
    const failure = signInFailureMessage(params);

    // Tidy the URL before anything else so a refresh — or an "add to home
    // screen" done at this moment — does not preserve a one-shot callback path.
    if (window.location.pathname === LOGIN_SUCCESS_PATH || params.has('error')) {
      window.history.replaceState({}, '', '/app/');
    }

    if (failure) {
      setSession({ state: 'loggedOut', error: failure });
      return;
    }
    void refresh();
  }, [refresh]);

  const signIn = useCallback(() => {
    // A full-page navigation, not fetch: this is a browser redirect flow through
    // accounts.google.com and back to the server's own callback.
    window.location.assign(`/auth/google?returnTo=${encodeURIComponent(APP_BASE)}`);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setSession({ state: 'loggedOut' });
  }, []);

  return { session, signIn, signOut };
}
