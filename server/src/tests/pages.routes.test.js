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

const request = require('supertest');
const app = require('../app');

describe('public pages', () => {
  test('GET /privacy returns 200 HTML with contact + deletion link', async () => {
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('udayakavindadev@gmail.com');
    expect(res.text).toContain('/delete');
  });

  test('GET /delete returns 200 HTML with contact + privacy link', async () => {
    const res = await request(app).get('/delete');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('udayakavindadev@gmail.com');
    expect(res.text).toContain('/privacy');
  });

  test('not gated by CSRF middleware (no X-Requested-With needed, GET only)', async () => {
    const res = await request(app).get('/delete').set('X-Requested-With', '');
    expect(res.status).toBe(200);
  });
});
