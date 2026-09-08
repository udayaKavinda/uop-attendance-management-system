'use strict';

// Mock connect-mongo before the app is loaded (MongoStore.create runs at module load).
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
const mongoose = require('mongoose');
const app = require('../app');
const settingsService = require('../services/settings.service');

describe('GET /api/healthz', () => {
  test('reports 503/"down" when Mongo is not connected — the deploy workflow\'s rollback depends on this being honest', () => {
    expect(mongoose.connection.readyState).not.toBe(1);
    return request(app).get('/api/healthz').then((res) => {
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('down');
      expect(res.body.mongo).not.toBe(1);
    });
  });

  test('reports 200/"ok" once Mongo reports connected', async () => {
    const original = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
    try {
      const res = await request(app).get('/api/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', mongo: 1 });
    } finally {
      if (original) Object.defineProperty(mongoose.connection, 'readyState', original);
    }
  });
});

describe('GET /api/app-version', () => {
  test('is public — the Android app checks this before anyone has signed in', async () => {
    jest.spyOn(settingsService, 'getSettings').mockResolvedValue({ minSupportedVersionCode: 0 });
    const res = await request(app).get('/api/app-version');
    expect(res.status).toBe(200);
  });

  test('reports the admin-configured minimum version code', async () => {
    jest.spyOn(settingsService, 'getSettings').mockResolvedValue({ minSupportedVersionCode: 42 });
    const res = await request(app).get('/api/app-version');
    expect(res.body).toEqual({ minSupportedVersionCode: 42 });
  });

  test('defaults to 0 (no minimum enforced) when unset', async () => {
    jest.spyOn(settingsService, 'getSettings').mockResolvedValue({});
    const res = await request(app).get('/api/app-version');
    expect(res.body).toEqual({ minSupportedVersionCode: 0 });
  });
});
