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

// BleToken in-memory store — lets bluetoothCode work without a real MongoDB connection.
// These tests only ever exercise the primary row (no seeding), so one doc per
// sessionId is enough — `find`/`deleteMany` just wrap that single doc as a pool of one.
const _bleTokenStore = {};
jest.mock('../models/BleToken', () => ({
  findOne: jest.fn(({ sessionId }) => Promise.resolve(_bleTokenStore[sessionId] ?? null)),
  find: jest.fn(({ sessionId }) => {
    const doc = _bleTokenStore[sessionId];
    return Promise.resolve(doc ? [doc] : []);
  }),
  findOneAndUpdate: jest.fn(({ sessionId }, update) => {
    const doc = { ...(_bleTokenStore[sessionId] || {}), sessionId, ...update };
    _bleTokenStore[sessionId] = doc;
    return Promise.resolve(doc);
  }),
  deleteOne: jest.fn(({ sessionId }) => {
    delete _bleTokenStore[sessionId];
    return Promise.resolve({ deletedCount: 1 });
  }),
  deleteMany: jest.fn(({ sessionId }) => {
    const existed = sessionId in _bleTokenStore;
    delete _bleTokenStore[sessionId];
    return Promise.resolve({ deletedCount: existed ? 1 : 0 });
  }),
  countDocuments: jest.fn(() => Promise.resolve(0)),
}));

// Mock models before loading the app
jest.mock('../models/Person', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/Course', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/LectureSession', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../models/Attendance', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  distinct: jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));

// Settings singleton mock — accepting attendance now also runs seeder selection,
// which reads Settings.seedRate (default 0, so seeding stays a no-op for these tests).
let mockSettingsStore = null;
jest.mock('../models/Settings', () => ({
  findOneAndUpdate: jest.fn((_filter, update) => {
    if (!mockSettingsStore) {
      mockSettingsStore = {
        manualCodeAllowed: true, bluetoothAllowed: true, geofenceAllowed: false, seedRate: 0, seedWindowMs: 60000, bufferGpsOnly: 30, bufferGpsBle: 15,
      };
    }
    if (update.$set) Object.assign(mockSettingsStore, update.$set);
    return Promise.resolve({ ...mockSettingsStore });
  }),
}));

const request = require('supertest');
const mongoose = require('mongoose');

const Person = require('../models/Person');
const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');
const bluetoothCode = require('../services/bluetoothCode.service');
const { BROADCAST_STALE_MS } = require('../utils/constants');

const app = require('../app');

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function todayDay() {
  return DAY_NAMES[new Date().getDay()];
}

function otherDay() {
  const today = todayDay();
  return DAY_NAMES.find((d) => d !== today) || 'SUN';
}

function makeId() {
  return new mongoose.Types.ObjectId().toHexString();
}

function makeSession(overrides = {}) {
  const id = makeId();
  return {
    _id: id,
    course: makeId(),
    lectureDay: todayDay(),
    startTime: '00:00',
    endTime: '23:59',
    recurring: true,
    verification: 'bluetooth',
    active: true,
    deleted: false,
    broadcasting: true,
    lastBroadcastSeenAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeCourse(overrides = {}) {
  const id = makeId();
  return {
    _id: id,
    code: 'CS101',
    active: true,
    lecturers: [],
    ...overrides,
  };
}

function makePerson(overrides = {}) {
  return {
    _id: makeId(),
    email: 'test@example.com',
    role: 'student',
    deleted: false,
    ...overrides,
  };
}

/** Auth header only — for GET requests (full person so middleware can read role without DB). */
function authHeader(person) {
  return { 'x-test-user': JSON.stringify({ ...person, _id: String(person._id) }) };
}

/** Auth + CSRF header — required for POST/PATCH/DELETE */
const csrfHeader = { 'x-requested-with': 'fetch' };

function headers(person) {
  return { ...authHeader(person), ...csrfHeader };
}

// Clear mocks and in-memory BleToken store before each test for isolation
beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(_bleTokenStore).forEach(k => delete _bleTokenStore[k]);
});

// ─── PATCH /broadcast (on/off toggle) ────────────────────────────────────────

describe('PATCH /api/admin/sessions/:id/broadcast', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app)
      .patch(`/api/admin/sessions/${makeId()}/broadcast`)
      .set(csrfHeader)
      .send({ on: true });
    expect(res.status).toBe(401);
  });

  test('403 when authenticated as student', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .patch(`/api/admin/sessions/${makeId()}/broadcast`)
      .set(headers(student))
      .send({ on: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/staff/i);
  });

  test('404 when session not found', async () => {
    const admin = makePerson({ role: 'admin' });
    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/admin/sessions/${makeId()}/broadcast`)
      .set(headers(admin))
      .send({ on: true });
    expect(res.status).toBe(404);
  });

  test('403 when lecturer does not own the course', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [] }); // lecturer not in list
    const session = makeSession({ course: course._id });

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer))
      .send({ on: true });
    expect(res.status).toBe(403);
  });

  test('400 when `on` is missing or not a boolean', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse();
    const session = makeSession({ course: course._id });

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    for (const body of [{}, { on: 'yes' }, { on: 1 }]) {
      const res = await request(app)
        .patch(`/api/admin/sessions/${session._id}/broadcast`)
        .set(headers(admin))
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/boolean/i);
    }
    expect(session.save).not.toHaveBeenCalled();
  });

  test('200 — {on:true} seeds the token and stamps the heartbeat', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({
      course: course._id,
      broadcasting: false,
      lastBroadcastSeenAt: null,
    });

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer))
      .send({ on: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(session.save).toHaveBeenCalled();
    expect(session.broadcasting).toBe(true);
    expect(session.lastBroadcastSeenAt).toBeInstanceOf(Date);
    // Token must be seeded in the database-backed pool.
    const { token } = await bluetoothCode.getToken(String(session._id));
    expect(token).toMatch(/^[0-9a-f]{16}$/);

    await bluetoothCode.removeToken(String(session._id));
  });

  test('200 — {on:false} turns broadcast off and removes the token', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({ course: course._id });

    // Pre-seed a token
    await bluetoothCode.getToken(String(session._id));

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer))
      .send({ on: false });

    expect(res.status).toBe(200);
    expect(session.broadcasting).toBe(false);
    expect(session.lastBroadcastSeenAt).toBeNull();
    // Token removed
    expect(await bluetoothCode.verifyToken(String(session._id), 'anytoken')).toBe(false);
  });

  test('200 — admin can toggle broadcast for any session without course ownership', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse({ lecturers: [] });
    const session = makeSession({ course: course._id, broadcasting: false });

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(admin))
      .send({ on: true });

    expect(res.status).toBe(200);
    expect(session.broadcasting).toBe(true);

    await bluetoothCode.removeToken(String(session._id));
  });

  test('400 — {on:true} rejected outside the scheduled time window', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({
      course: course._id,
      broadcasting: false,
      lectureDay: otherDay(),
    });

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer))
      .send({ on: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scheduled time window/i);
    expect(session.broadcasting).not.toBe(true);
    expect(session.save).not.toHaveBeenCalled();
  });

  test('400 — {on:true} rejected when session is inactive', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse();
    const session = makeSession({ course: course._id, active: false, broadcasting: false });

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(admin))
      .send({ on: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not active/i);
    expect(session.save).not.toHaveBeenCalled();
  });

  test('400 — {on:true} rejected when course is disabled', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse({ active: false });
    const session = makeSession({ course: course._id, broadcasting: false });

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(admin))
      .send({ on: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/course is disabled/i);
    expect(session.save).not.toHaveBeenCalled();
  });

  test('400 — geofence-only sessions cannot start a Bluetooth broadcast', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse();
    const session = makeSession({
      course: course._id,
      verification: 'geofence',
      broadcasting: false,
    });
    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(admin))
      .send({ on: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
    expect(session.save).not.toHaveBeenCalled();
  });
});

// ─── GET /broadcast (token poll + heartbeat) ─────────────────────────────────

describe('GET /api/admin/sessions/:id/broadcast', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get(`/api/admin/sessions/${makeId()}/broadcast`);
    expect(res.status).toBe(401);
  });

  test('400 when broadcast is off', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({ course: course._id, broadcasting: false });

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .get(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not on/i);
  });

  test('200 — returns token, timing and attendance count, and stamps the heartbeat', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const staleStamp = new Date(Date.now() - 60_000);
    const session = makeSession({ course: course._id, lastBroadcastSeenAt: staleStamp });

    await bluetoothCode.getToken(String(session._id)); // seed
    Attendance.countDocuments.mockResolvedValueOnce(3);

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .get(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer));

    expect(res.status).toBe(200);
    expect(res.body.broadcasting).toBe(true);
    expect(res.body.token).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof res.body.rotatesIn).toBe('number');
    expect(res.body.rotationMs).toBe(15000);
    // Live "students marked" count and time-remaining, surfaced in the app's
    // notification/dashboard instead of the raw token or rotation countdown.
    expect(res.body.attendanceCount).toBe(3);
    expect(typeof res.body.minutesRemaining).toBe('number');

    // The poll doubles as the heartbeat: the stale stamp must be refreshed.
    expect(session.save).toHaveBeenCalled();
    expect(session.lastBroadcastSeenAt.getTime()).toBeGreaterThan(staleStamp.getTime());

    await bluetoothCode.removeToken(String(session._id));
  });

  test('400 — poll outside the schedule window auto-closes the broadcast', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({
      course: course._id,
      broadcasting: true,
      lectureDay: otherDay(),
    });

    await bluetoothCode.getToken(String(session._id));

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .get(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(lecturer));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scheduled time window/i);
    expect(session.broadcasting).toBe(false);
    expect(session.lastBroadcastSeenAt).toBeNull();

    await bluetoothCode.removeToken(String(session._id));
  });

  test('200 — admin can read broadcast token for any session', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse();
    const session = makeSession({ course: course._id });

    await bluetoothCode.getToken(String(session._id));

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .get(`/api/admin/sessions/${session._id}/broadcast`)
      .set(headers(admin));

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[0-9a-f]{16}$/);

    await bluetoothCode.removeToken(String(session._id));
  });
});

// ─── bluetooth-target (student) ───────────────────────────────────────────────

describe('GET /api/bluetooth-target', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get(`/api/bluetooth-target?courseId=${makeId()}`);
    expect(res.status).toBe(401);
  });

  test('403 when authenticated as lecturer (not student)', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    Person.findById.mockResolvedValue(lecturer);

    const res = await request(app)
      .get(`/api/bluetooth-target?courseId=${makeId()}`)
      .set(headers(lecturer));
    expect(res.status).toBe(403);
  });

  test('400 for invalid courseId', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .get('/api/bluetooth-target?courseId=not-an-object-id')
      .set(headers(student));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/courseId/i);
  });

  test('400 when course has no active session now', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([]); // no sessions

    const res = await request(app)
      .get(`/api/bluetooth-target?courseId=${course._id}`)
      .set(headers(student));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active lecture session/i);
  });

  test('400 when broadcast is off', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id, broadcasting: false });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .get(`/api/bluetooth-target?courseId=${course._id}`)
      .set(headers(student));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not open/i);
  });

  test('400 when broadcast heartbeat is stale (dead broadcaster)', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({
      course: course._id,
      broadcasting: true,
      lastBroadcastSeenAt: new Date(Date.now() - BROADCAST_STALE_MS - 1_000),
    });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .get(`/api/bluetooth-target?courseId=${course._id}`)
      .set(headers(student));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not open/i);
  });

  test('200 — confirms that a Bluetooth attendance channel is available', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .get(`/api/bluetooth-target?courseId=${course._id}`)
      .set(headers(student));

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.sessionId).toBeUndefined(); // not exposed
  });
});

// ─── unified attendance, Bluetooth method (student) ──────────────────────────────────────────

describe('POST /api/attendance', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).post('/api/attendance').set(csrfHeader).send({});
    expect(res.status).toBe(401);
  });

  test('403 when authenticated as admin (not student)', async () => {
    const admin = makePerson({ role: 'admin' });
    Person.findById.mockResolvedValue(admin);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(admin))
      .send({ courseId: makeId(), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(403);
  });

  test('400 for invalid courseId', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: 'bad', token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/courseId/i);
  });

  test('400 for invalid BT token format', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: makeId(), token: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bluetooth token/i);
  });

  test('400 when no active session', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
  });

  test('400 when broadcast is off', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id, broadcasting: false });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not open/i);
  });

  test('400 when broadcast heartbeat is stale (dead broadcaster)', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({
      course: course._id,
      broadcasting: true,
      lastBroadcastSeenAt: new Date(Date.now() - BROADCAST_STALE_MS - 1_000),
    });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    await bluetoothCode.getToken(String(session._id));

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not open/i);

    await bluetoothCode.removeToken(String(session._id));
  });

  test('400 when token is wrong', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);
    Attendance.findOne.mockResolvedValue(null);

    // Seed a real token but submit a wrong one
    await bluetoothCode.getToken(String(session._id));

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'deadbeefdeadbeef' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);

    await bluetoothCode.removeToken(String(session._id));
  });

  test('200 — records attendance with correct token (student role)', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);
    Attendance.findOne.mockResolvedValue(null);

    const { token } = await bluetoothCode.getToken(String(session._id));

    const mockAttendance = {
      _id: makeId(),
      student: student._id,
      session: session._id,
      method: 'bluetooth',
    };
    Attendance.create.mockResolvedValue(mockAttendance);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.attendance).toBeUndefined();
    expect(Attendance.create).toHaveBeenCalledWith(expect.objectContaining({
      method: 'bluetooth',
      lectureCode: `${session.lectureDay} ${session.startTime}-${session.endTime}`,
    }));

    await bluetoothCode.removeToken(String(session._id));
  });

  test('200 with duplicate:true when attendance already recorded today', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id });

    const existingAttendance = { _id: makeId(), method: 'bluetooth' };
    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);
    Attendance.findOne.mockResolvedValue(existingAttendance);

    const { token } = await bluetoothCode.getToken(String(session._id));

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(Attendance.create).not.toHaveBeenCalled();

    await bluetoothCode.removeToken(String(session._id));
  });
});
