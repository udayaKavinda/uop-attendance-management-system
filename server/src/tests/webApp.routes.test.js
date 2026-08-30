'use strict';

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

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');
const { WEB_APP_MOUNT_PATH } = require('../utils/constants');

const DIST_DIR = path.resolve(__dirname, '../../../web/dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const isBuilt = fs.existsSync(INDEX_HTML);

describe('iOS web client mount', () => {
  test('serves the SPA document at the mount root', async () => {
    const res = await request(app).get(`${WEB_APP_MOUNT_PATH}/`);
    if (isBuilt) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      // Never cache the one mutable document, or a student keeps booting
      // yesterday's bundle against today's API.
      expect(res.headers['cache-control']).toMatch(/no-cache/);
    } else {
      // An unbuilt client must degrade to a clear 503, never take the API down.
      expect(res.status).toBe(503);
      expect(res.text).toMatch(/has not been built/);
    }
  });

  test('client-side routes fall back to the same document', async () => {
    const res = await request(app).get(`${WEB_APP_MOUNT_PATH}/login/success`);
    expect(res.status).toBe(isBuilt ? 200 : 503);
  });

  // The remaining assertions need real build output to inspect.
  const whenBuilt = isBuilt ? test : test.skip;

  whenBuilt('serves the PWA manifest and the iOS home-screen icon', async () => {
    const manifest = await request(app).get(`${WEB_APP_MOUNT_PATH}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    // start_url/scope must match the mount path or iOS opens the wrong page.
    expect(JSON.parse(manifest.text).start_url).toBe(`${WEB_APP_MOUNT_PATH}/`);

    // iOS ignores SVG for "Add to Home Screen"; a real PNG has to be there.
    const icon = await request(app).get(`${WEB_APP_MOUNT_PATH}/apple-touch-icon.png`);
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toMatch(/image\/png/);
  });

  whenBuilt('caches fingerprinted assets immutably, unhashed files only briefly', async () => {
    const document = await request(app).get(`${WEB_APP_MOUNT_PATH}/`);
    const assetPath = (document.text.match(/\/app\/assets\/[A-Za-z0-9._-]+\.js/) || [])[0];
    expect(assetPath).toBeDefined();

    const asset = await request(app).get(assetPath);
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toMatch(/immutable/);

    // The manifest keeps a stable name across releases, so it must not be
    // pinned for a year the way the hashed bundles are.
    const manifest = await request(app).get(`${WEB_APP_MOUNT_PATH}/manifest.webmanifest`);
    expect(manifest.headers['cache-control']).not.toMatch(/immutable/);
  });

  test('the bare domain redirects to the client instead of 404ing', async () => {
    const res = await request(app).get('/');
    // Temporary on purpose — a cached 301 would make giving "/" its own page later
    // very painful.
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB_APP_MOUNT_PATH}/`);
  });

  test('does not shadow the public /privacy and /delete pages', async () => {
    for (const route of ['/privacy', '/delete']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    }
  });

  test('does not shadow the API', async () => {
    // healthz answers 503 with no database, which is a real answer from the
    // health controller — what matters is that it is JSON from the API and not
    // the web client's plain-text "not built" fallback.
    const res = await request(app).get('/api/healthz');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('status');
  });
});

describe('web client OAuth return base', () => {
  const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL;

  afterEach(() => {
    process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL;
    jest.resetModules();
  });

  test('the app origin plus the mount path is an allowed returnTo', () => {
    process.env.APP_BASE_URL = 'https://attendance.example.test';
    jest.resetModules();
    const oauthService = require('../services/oauth.service');

    const returnTo = `https://attendance.example.test${WEB_APP_MOUNT_PATH}`;
    expect(oauthService.webAppReturnBase()).toBe(returnTo);
    expect(oauthService.pickOAuthReturnBase({ query: { returnTo } })).toBe(returnTo);
  });

  test('an unrelated origin is still rejected and falls back to the app origin', () => {
    process.env.APP_BASE_URL = 'https://attendance.example.test';
    jest.resetModules();
    const oauthService = require('../services/oauth.service');

    const picked = oauthService.pickOAuthReturnBase({
      query: { returnTo: 'https://phishing.example.com/app' },
    });
    expect(picked).toBe('https://attendance.example.test');
  });

  test('the web client is same-origin, so it needs no CORS entry', () => {
    process.env.APP_BASE_URL = 'https://attendance.example.test';
    jest.resetModules();
    const { corsOrigins } = require('../config/cors');
    const oauthService = require('../services/oauth.service');

    // Same-origin is the whole point: Safari blocks third-party cookies, so the
    // client shares the API's origin and never triggers a cross-origin request.
    expect(corsOrigins).not.toContain(oauthService.webAppReturnBase());
  });
});
