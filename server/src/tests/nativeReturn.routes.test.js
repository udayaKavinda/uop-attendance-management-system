'use strict';

/**
 * Regression tests for the /auth/native-return target handling.
 *
 * The route used to accept any string beginning with an allow-listed base and
 * then embed it in an inline `<script>` via JSON.stringify — which escapes
 * quotes but not `</script>`, so a crafted target closed the script element and
 * the remainder executed as markup on this origin.
 */

// Mock connect-mongo before the app is loaded (MongoStore.create runs at module load)
jest.mock('connect-mongo', () => ({
  MongoStore: {
    create: jest.fn().mockReturnValue({
      on: jest.fn(),
      get: jest.fn((sid, cb) => cb(null, null)),
      set: jest.fn((sid, s, cb) => cb(null)),
      destroy: jest.fn((sid, cb) => cb(null)),
    }),
  },
}));

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret';

const request = require('supertest');
const app = require('../app');
const oauthService = require('../services/oauth.service');

const BASE = 'lk.ac.pdn.eng.attendance://oauth';
const CODE = 'a'.repeat(64);

const get = (target) => request(app).get(`/auth/native-return?target=${encodeURIComponent(target)}`);

describe('GET /auth/native-return', () => {
  describe('accepts exactly what the OAuth callback actually produces', () => {
    test.each([
      ['the bare base', BASE],
      ['the base with a trailing slash', `${BASE}/`],
      ['the success path with a code', `${BASE}/login/success?code=${CODE}`],
      ['the failure path', `${BASE}/?error=auth`],
      ['the second registered scheme', `lk.uop.attendance://oauth/login/success?code=${CODE}`],
    ])('%s', async (_label, target) => {
      const res = await get(target);
      expect(res.status).toBe(200);
    });
  });

  describe('rejects anything else', () => {
    test.each([
      ['a foreign origin', 'https://evil.example.com'],
      ['a javascript: url', 'javascript:alert(1)'],
      ['a host glued onto the scheme', `${BASE}.evil.com/x`],
      ['a path outside the known set', `${BASE}/../../evil`],
      ['an unexpected query parameter', `${BASE}/login/success?code=${CODE}&next=//evil.com`],
      ['a code that is not a real exchange code', `${BASE}/login/success?code=notarealcode`],
      ['an error value carrying markup', `${BASE}/?error=<script>`],
      ['a script-tag breakout', `${BASE}</script><script>window.__pwned=1</script>`],
      ['an attribute breakout', `${BASE}"><img src=x onerror=alert(1)>`],
      ['an absurdly long target', BASE + 'x'.repeat(600)],
      ['no target at all', ''],
    ])('%s', async (_label, target) => {
      const res = await get(target);
      expect(res.status).toBe(400);
    });
  });

  test('emits no script element, so nothing injected could execute', async () => {
    const res = await get(`${BASE}/login/success?code=${CODE}`);
    expect(res.text).not.toMatch(/<script/i);
    expect(res.text).toContain('http-equiv="refresh"');
  });

  test('serves a policy that forbids script entirely', async () => {
    const res = await get(BASE);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    // No script-src directive at all, so default-src 'none' blocks every script.
    // The old policy had to carry script-src 'unsafe-inline' for its redirect,
    // which is exactly what made an injected target executable.
    expect(csp).not.toContain('script-src');
  });

  test('reflects only the validated code, never the caller\'s own string', async () => {
    const res = await get(`${BASE}/login/success?code=${CODE}`);
    expect(res.text).toContain(`${BASE}/login/success?code=${CODE}`);
  });

  describe('parseNativeReturnTarget', () => {
    test('breaks a valid target into base, path and code', () => {
      expect(oauthService.parseNativeReturnTarget(`${BASE}/login/success?code=${CODE}`)).toEqual({
        base: BASE, path: '/login/success', code: CODE, error: null,
      });
    });

    test('returns null rather than silently dropping an unknown parameter', () => {
      expect(oauthService.parseNativeReturnTarget(`${BASE}?state=x`)).toBeNull();
    });

    test('rebuilds the url from the parsed parts', () => {
      const parsed = oauthService.parseNativeReturnTarget(`${BASE}/?error=auth`);
      expect(oauthService.nativeReturnUrl(parsed)).toBe(`${BASE}/?error=auth`);
    });
  });
});
