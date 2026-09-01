'use strict';

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

const mongoose = require('mongoose');

let mockStore = [];
let mockSessions = [];

jest.mock('../models/Geofence', () => {
  const actualMongoose = jest.requireActual('mongoose');
  return {
    // Mongoose's find() returns a chainable Query; only .sort() is used by geofence.service.
    find: jest.fn((filter = {}) => ({
      sort: jest.fn(() => Promise.resolve(mockStore.filter(
        (g) => !g.deleted && (filter.active !== true || g.active === true),
      ))),
    })),
    findOne: jest.fn(({ _id, deleted }) => Promise.resolve(
      mockStore.find((g) => String(g._id) === String(_id) && g.deleted === deleted) || null,
    )),
    create: jest.fn(({ name, polygon }) => {
      const doc = {
        _id: new actualMongoose.Types.ObjectId().toHexString(),
        name,
        polygon,
        active: true,
        deleted: false,
        save: jest.fn(function save() { return Promise.resolve(this); }),
      };
      mockStore.push(doc);
      return Promise.resolve(doc);
    }),
  };
});

jest.mock('../models/LectureSession', () => ({
  countDocuments: jest.fn((filter = {}) => {
    const building = filter.buildings ? String(filter.buildings) : null;
    return Promise.resolve(mockSessions.filter(
      (s) => s.deleted === filter.deleted
        && (!building || (s.buildings || []).map(String).includes(building)),
    ).length);
  }),
}));

jest.mock('../models/Person', () => ({ findById: jest.fn(), findOne: jest.fn() }));

const request = require('supertest');
const app = require('../app');

function makePerson(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId().toHexString(), email: 'a@b.com', role: 'student', deleted: false, ...overrides,
  };
}
function authHeader(person) {
  return { 'x-test-user': JSON.stringify({ ...person, _id: String(person._id) }) };
}
const csrfHeader = { 'x-requested-with': 'fetch' };
function headers(person) {
  return { ...authHeader(person), ...csrfHeader };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = [];
  mockSessions = [];
});

/** Seeds a live building straight into the store, bypassing the create route. */
function seedBuilding(overrides = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId().toHexString(),
    name: 'Block A',
    polygon: [[80.59, 7.25], [80.60, 7.25], [80.60, 7.26]],
    active: true,
    deleted: false,
    save: jest.fn(function save() { return Promise.resolve(this); }),
    ...overrides,
  };
  mockStore.push(doc);
  return doc;
}

describe('GET/POST/PATCH/DELETE /api/admin/geofences', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/geofences');
    expect(res.status).toBe(401);
  });

  test('lecturers can list buildings (needed to pick one for a geofence session) but not create one', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const getRes = await request(app).get('/api/admin/geofences').set(authHeader(lecturer));
    expect(getRes.status).toBe(200);

    const postRes = await request(app)
      .post('/api/admin/geofences')
      .set(headers(lecturer))
      .send({ name: 'Hall', polygon: [[0, 0], [1, 0], [1, 1]] });
    expect(postRes.status).toBe(403);
  });

  test('rejects a polygon with fewer than 3 vertices', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app)
      .post('/api/admin/geofences')
      .set(headers(admin))
      .send({ name: 'Lecture Hall 1', polygon: [[0, 0], [1, 1]] });
    expect(res.status).toBe(400);
  });

  test('rejects an out-of-range coordinate', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app)
      .post('/api/admin/geofences')
      .set(headers(admin))
      .send({ name: 'Bad', polygon: [[0, 0], [200, 1], [1, 1]] });
    expect(res.status).toBe(400);
  });

  test('creates a geofence and it appears in the list', async () => {
    const admin = makePerson({ role: 'admin' });
    const create = await request(app)
      .post('/api/admin/geofences')
      .set(headers(admin))
      .send({ name: 'Lecture Hall 1', polygon: [[79.8, 6.9], [79.801, 6.9], [79.801, 6.901]] });
    expect(create.status).toBe(200);
    expect(create.body.geofence.name).toBe('Lecture Hall 1');

    const list = await request(app).get('/api/admin/geofences').set(authHeader(admin));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
  });

  test('404 when patching a geofence that does not exist', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app)
      .patch(`/api/admin/geofences/${new mongoose.Types.ObjectId().toHexString()}`)
      .set(headers(admin))
      .send({ name: 'New name' });
    expect(res.status).toBe(404);
  });

  test('400 when the patch body has no recognized fields', async () => {
    const admin = makePerson({ role: 'admin' });
    const create = await request(app)
      .post('/api/admin/geofences')
      .set(headers(admin))
      .send({ name: 'Hall', polygon: [[0, 0], [1, 0], [1, 1]] });
    const res = await request(app)
      .patch(`/api/admin/geofences/${create.body.geofence._id}`)
      .set(headers(admin))
      .send({});
    expect(res.status).toBe(400);
  });

  test('inactive buildings are excluded from the selectable list', async () => {
    const admin = makePerson({ role: 'admin' });
    const create = await request(app)
      .post('/api/admin/geofences')
      .set(headers(admin))
      .send({ name: 'Closed hall', polygon: [[0, 0], [1, 0], [1, 1]] });
    await request(app)
      .patch(`/api/admin/geofences/${create.body.geofence._id}`)
      .set(headers(admin))
      .send({ active: false });

    const list = await request(app).get('/api/admin/geofences').set(authHeader(admin));
    expect(list.body.items).toEqual([]);
  });
});

/** A building in use by a live session is not the admin's to remove out from under it. */
describe('DELETE /api/admin/geofences/:id — in-use guard', () => {
  const admin = () => makePerson({ role: 'admin' });

  test('refuses while a live session references the building', async () => {
    const building = seedBuilding();
    mockSessions.push({ _id: 's1', buildings: [building._id], deleted: false });

    const res = await request(app)
      .delete(`/api/admin/geofences/${building._id}`)
      .set(headers(admin()));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 session still uses it/);
    expect(building.save).not.toHaveBeenCalled();
    expect(building.deleted).toBe(false);
  });

  test('pluralises the refusal across several sessions', async () => {
    const building = seedBuilding();
    mockSessions.push(
      { _id: 's1', buildings: [building._id], deleted: false },
      { _id: 's2', buildings: [building._id], deleted: false },
    );

    const res = await request(app)
      .delete(`/api/admin/geofences/${building._id}`)
      .set(headers(admin()));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2 sessions still use it/);
  });

  test('refuses even when the session lists other buildings alongside it', async () => {
    const building = seedBuilding({ name: 'Block A' });
    const spare = seedBuilding({ name: 'Block B' });
    mockSessions.push({ _id: 's1', buildings: [building._id, spare._id], deleted: false });

    const res = await request(app)
      .delete(`/api/admin/geofences/${building._id}`)
      .set(headers(admin()));

    expect(res.status).toBe(400);
    expect(building.deleted).toBe(false);
  });

  test('allows the delete when only soft-deleted sessions reference the building', async () => {
    const building = seedBuilding();
    mockSessions.push({ _id: 'gone', buildings: [building._id], deleted: true });

    const res = await request(app)
      .delete(`/api/admin/geofences/${building._id}`)
      .set(headers(admin()));

    expect(res.status).toBe(200);
    expect(building.deleted).toBe(true);
    expect(building.active).toBe(false);
  });

  test('an unused building still deletes', async () => {
    const building = seedBuilding();

    const res = await request(app)
      .delete(`/api/admin/geofences/${building._id}`)
      .set(headers(admin()));

    expect(res.status).toBe(200);
    expect(building.deleted).toBe(true);
  });
});
