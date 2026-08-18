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

const mockBleTokenStore = {};
jest.mock('../models/BleToken', () => ({
  findOne: jest.fn(({ sessionId }) => Promise.resolve(mockBleTokenStore[sessionId] ?? null)),
  find: jest.fn(({ sessionId }) => {
    const doc = mockBleTokenStore[sessionId];
    return Promise.resolve(doc ? [doc] : []);
  }),
  findOneAndUpdate: jest.fn(({ sessionId }, update) => {
    const doc = { ...(mockBleTokenStore[sessionId] || {}), sessionId, ...update };
    mockBleTokenStore[sessionId] = doc;
    return Promise.resolve(doc);
  }),
  deleteMany: jest.fn(({ sessionId }) => {
    delete mockBleTokenStore[sessionId];
    return Promise.resolve({ deletedCount: 1 });
  }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: jest.fn(() => Promise.resolve(0)),
}));

let mockSettingsStore = null;
jest.mock('../models/Settings', () => ({
  findOneAndUpdate: jest.fn((_filter, update) => {
    if (!mockSettingsStore) {
      mockSettingsStore = {
        manualCodeAllowed: true, bluetoothAllowed: true, geofenceAllowed: true, seedRate: 0, seedWindowMs: 60000, bufferGpsOnly: 30, bufferGpsBle: 15,
      };
    }
    if (update.$set) Object.assign(mockSettingsStore, update.$set);
    return Promise.resolve({ ...mockSettingsStore });
  }),
}));

let mockGeofenceStore = [];
jest.mock('../models/Geofence', () => ({
  find: jest.fn(({ _id, active }) => {
    const ids = _id?.$in?.map(String) || [];
    return Promise.resolve(mockGeofenceStore.filter(
      (g) => ids.includes(String(g._id)) && !g.deleted && (active !== true || g.active === true),
    ));
  }),
}));

jest.mock('../models/Person', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/Course', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/LectureSession', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../models/Attendance', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  distinct: jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
  updateOne: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/ManualCode', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() }));

const request = require('supertest');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');

const app = require('../app');

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function todayDay() { return DAY_NAMES[new Date().getDay()]; }
function makeId() { return new mongoose.Types.ObjectId().toHexString(); }

function makeSession(overrides = {}) {
  return {
    _id: makeId(),
    course: makeId(),
    lectureDay: todayDay(),
    startTime: '00:00',
    endTime: '23:59',
    recurring: true,
    active: true,
    deleted: false,
    verification: 'bluetooth',
    buildings: [],
    manualCodeEnabled: false,
    broadcasting: false,
    lastBroadcastSeenAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
function makeCourse(overrides = {}) {
  return {
    _id: makeId(), code: 'CS101', active: true, ...overrides,
  };
}
function makePerson(overrides = {}) {
  return {
    _id: makeId(), email: 'a@b.com', role: 'student', deleted: false, ...overrides,
  };
}
function authHeader(person) { return { 'x-test-user': JSON.stringify({ ...person, _id: String(person._id) }) }; }
const csrfHeader = { 'x-requested-with': 'fetch' };
function headers(person) { return { ...authHeader(person), ...csrfHeader }; }

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockBleTokenStore).forEach((k) => delete mockBleTokenStore[k]);
  mockGeofenceStore = [];
});

describe('POST /api/attendance — validation', () => {
  test('400 when none of token/fix/code are present', async () => {
    const student = makePerson();
    const res = await request(app).post('/api/attendance').set(headers(student)).send({ courseId: makeId() });
    expect(res.status).toBe(400);
  });

  test('400 when more than one of token/fix/code are present', async () => {
    const student = makePerson();
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: makeId(), token: 'a'.repeat(16), code: '12345678' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/attendance — GPS fix path', () => {
  test('accepts an authenticated student without a course-enrolment check once GPS is valid', async () => {
    const student = makePerson();
    const geofenceId = makeId();
    mockGeofenceStore.push({
      _id: geofenceId,
      polygon: [[79.8000, 6.9000], [79.8010, 6.9000], [79.8010, 6.9010], [79.8000, 6.9010]],
      active: true,
      deleted: false,
    });
    const session = makeSession({ verification: 'geofence', buildings: [geofenceId] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);
    Attendance.findOne.mockResolvedValue(null);
    Attendance.create.mockResolvedValue({ _id: makeId(), method: 'gps' });

    const fixBody = {
      courseId: course._id, fix: { lat: 6.9005, lng: 79.8005, accuracy: 5 },
    };

    const first = await request(app).post('/api/attendance').set(headers(student)).send(fixBody);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('pending');

    let last;
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(app).post('/api/attendance').set(headers(student)).send(fixBody);
    }
    expect(last.status).toBe(200);
    expect(last.body.status).toBe('accepted');
  });

  test('400 when the session has no building configured', async () => {
    const student = makePerson();
    const session = makeSession({ verification: 'geofence', buildings: [] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: course._id, fix: { lat: 6.9, lng: 79.8, accuracy: 5 } });
    expect(res.status).toBe(400);
  });

  test('400 for a bluetooth-only session (GPS not applicable)', async () => {
    const student = makePerson();
    const session = makeSession({ verification: 'bluetooth' });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: course._id, fix: { lat: 6.9, lng: 79.8, accuracy: 5 } });
    expect(res.status).toBe(400);
  });

  test('400 when a referenced building is inactive', async () => {
    const student = makePerson();
    const geofenceId = makeId();
    mockGeofenceStore.push({
      _id: geofenceId,
      polygon: [[79.8, 6.9], [79.801, 6.9], [79.801, 6.901]],
      active: false,
      deleted: false,
    });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([makeSession({ verification: 'geofence', buildings: [geofenceId] })]);
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: course._id, fix: { lat: 6.9, lng: 79.8, accuracy: 5 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active building/i);
  });
});

describe('POST /api/attendance — verification policy enforcement', () => {
  test('rejects a Bluetooth token for a geofence-only session', async () => {
    const student = makePerson();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([makeSession({
      verification: 'geofence',
      buildings: [makeId()],
      broadcasting: true,
      lastBroadcastSeenAt: new Date(),
    })]);
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: course._id, token: 'a'.repeat(16) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not use Bluetooth/i);
  });
});

describe('GET /api/attendance/seed-token', () => {
  test('400 for an invalid sessionId', async () => {
    const student = makePerson();
    const res = await request(app).get('/api/attendance/seed-token?sessionId=not-an-id').set(authHeader(student));
    expect(res.status).toBe(400);
  });

  test('404 when the session does not exist', async () => {
    const student = makePerson();
    LectureSession.findOne.mockResolvedValue(null);
    const res = await request(app).get(`/api/attendance/seed-token?sessionId=${makeId()}`).set(authHeader(student));
    expect(res.status).toBe(404);
  });

  test('400 once the seeding lease has ended (no live seed row)', async () => {
    const student = makePerson();
    const session = makeSession();
    LectureSession.findOne.mockResolvedValue(session);
    const res = await request(app).get(`/api/attendance/seed-token?sessionId=${session._id}`).set(authHeader(student));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/attendance/seed-token', () => {
  test('lets a student relinquish only their own seeder lease', async () => {
    const student = makePerson();
    const sessionId = makeId();
    const res = await request(app)
      .delete(`/api/attendance/seed-token?sessionId=${sessionId}`)
      .set(headers(student));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const BleToken = require('../models/BleToken');
    expect(BleToken.deleteOne).toHaveBeenCalledWith({
      sessionId,
      owner: String(student._id),
      role: 'seed',
    });
  });
});
