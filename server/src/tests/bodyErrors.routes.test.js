'use strict';

/**
 * Body-parser rejections are client mistakes. They used to fall through to the
 * generic 500 branch, which told a caller the server had broken when the caller
 * was at fault and filled error monitoring with false alarms.
 */

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
const { respondError } = require('../middlewares/errorHandler');

const X = { 'x-requested-with': 'XMLHttpRequest' };

describe('request body errors', () => {
  test('malformed JSON is a 400, not a 500', async () => {
    const res = await request(app).post('/api/attendance').set(X)
      .set('Content-Type', 'application/json')
      .send('{"courseId":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Malformed request body');
  });

  test('an oversized body is a 413, not a 500', async () => {
    const res = await request(app).post('/api/attendance').set(X)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ courseId: 'x'.repeat(400_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Request body is too large');
  });

  test('neither response leaks the parser message or a stack trace', async () => {
    const res = await request(app).post('/api/attendance').set(X)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(JSON.stringify(res.body)).not.toMatch(/JSON|Unexpected|at .*\.js:/);
  });

  test('a genuine server fault is still a 500', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    respondError(res, new Error('boom'));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
