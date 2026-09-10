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

/**
 * These three used to answer "Invalid identifier" / "Invalid input" /
 * "Duplicate value" — true, but with nothing a caller could act on. They now
 * name the offending FIELD. They must never name the offending VALUE: field
 * names come from our own schemas, values are caller-supplied and may be
 * personal data.
 */
describe('respondError names the field, never the value', () => {
  function capture(err) {
    let body;
    const res = {
      status(code) { this.code = code; return this; },
      json(payload) { body = { code: this.code, ...payload }; return this; },
    };
    respondError(res, err);
    return body;
  }

  test('a CastError names the path that failed to cast', () => {
    const out = capture(Object.assign(new Error('cast'), { name: 'CastError', path: 'courseId' }));
    expect(out.code).toBe(400);
    expect(out.error).toContain('courseId');
  });

  test('a ValidationError lists the invalid fields', () => {
    const out = capture(Object.assign(new Error('v'), {
      name: 'ValidationError',
      errors: { code: {}, batch: {} },
    }));
    expect(out.code).toBe(400);
    expect(out.error).toContain('code');
    expect(out.error).toContain('batch');
  });

  test('a duplicate-key error names the fields but not their values', () => {
    const out = capture(Object.assign(new Error('dup'), {
      code: 11000,
      keyValue: { code: 'CS101', batch: 'E23' },
    }));
    expect(out.code).toBe(409);
    expect(out.error).toContain('code');
    expect(out.error).toContain('batch');
    expect(out.error).not.toContain('CS101');
    expect(out.error).not.toContain('E23');
  });

  test('a field name that is not a plain schema path is dropped, not echoed', () => {
    const out = capture(Object.assign(new Error('cast'), {
      name: 'CastError',
      path: '<script>alert(1)</script>',
    }));
    expect(out.code).toBe(400);
    expect(out.error).not.toContain('script');
  });

  test('each branch still answers when the driver gives no field information', () => {
    expect(capture(Object.assign(new Error('c'), { name: 'CastError' })).code).toBe(400);
    expect(capture(Object.assign(new Error('v'), { name: 'ValidationError' })).code).toBe(400);
    expect(capture(Object.assign(new Error('d'), { code: 11000 })).code).toBe(409);
  });
});
