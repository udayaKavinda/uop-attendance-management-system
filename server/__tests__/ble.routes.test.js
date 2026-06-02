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

// BleToken in-memory store — lets bluetoothCode work without a real MongoDB connection
const _bleTokenStore = {};
jest.mock('../models/BleToken', () => ({
  findOne: jest.fn(({ sessionId }) => Promise.resolve(_bleTokenStore[sessionId] ?? null)),
  findOneAndUpdate: jest.fn(({ sessionId }, update) => {
    const doc = { ...(_bleTokenStore[sessionId] || {}), sessionId, ...update };
    _bleTokenStore[sessionId] = doc;
    return Promise.resolve(doc);
  }),
  deleteOne: jest.fn(({ sessionId }) => {
    delete _bleTokenStore[sessionId];
    return Promise.resolve({ deletedCount: 1 });
  }),
}));

// Mock models before loading the app
jest.mock('../models/Person', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/Course', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/LectureSession', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../models/Attendance', () => ({ findOne: jest.fn(), create: jest.fn(), distinct: jest.fn() }));

const request = require('supertest');
const mongoose = require('mongoose');

const Person = require('../models/Person');
const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');
const bluetoothCode = require('../lib/bluetoothCode');

const app = require('../index');

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function todayDay() {
  return DAY_NAMES[new Date().getDay()];
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    active: true,
    deleted: false,
    bluetoothEnabled: true,
    bluetoothDeviceName: 'UOP-TESTDEV1',
    attendancePaused: false,
    rotationEnabled: false,
    rotationPaused: true,
    rotationOccurrenceKey: todayYmd(),
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

/** Auth header only — for GET requests */
function authHeader(person) {
  return { 'x-test-user': JSON.stringify({ _id: String(person._id) }) };
}

/** Auth + CSRF header — required for POST/PATCH/DELETE */
const csrfHeader = { 'x-requested-with': 'fetch' };

function headers(person) {
  return { ...authHeader(person), ...csrfHeader };
}

// Clear the in-memory BleToken store before each test for isolation
beforeEach(() => {
  Object.keys(_bleTokenStore).forEach(k => delete _bleTokenStore[k]);
});

// ─── bluetooth/start and bluetooth/stop ──────────────────────────────────────

describe('PATCH /api/admin/sessions/:id/bluetooth/start', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).patch(`/api/admin/sessions/${makeId()}/bluetooth/start`).set(csrfHeader);
    expect(res.status).toBe(401);
  });

  test('403 when authenticated as student', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .patch(`/api/admin/sessions/${makeId()}/bluetooth/start`)
      .set(headers(student));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/staff/i);
  });

  test('404 when session not found', async () => {
    const admin = makePerson({ role: 'admin' });
    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/admin/sessions/${makeId()}/bluetooth/start`)
      .set(headers(admin));
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
      .patch(`/api/admin/sessions/${session._id}/bluetooth/start`)
      .set(headers(lecturer));
    expect(res.status).toBe(403);
  });

  test('200 — lecturer with course access enables BT and gets a token seeded', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({
      course: course._id,
      bluetoothEnabled: false,
      bluetoothDeviceName: '',
    });

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/bluetooth/start`)
      .set(headers(lecturer));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(session.save).toHaveBeenCalled();
    expect(session.bluetoothEnabled).toBe(true);
    expect(session.bluetoothDeviceName).toMatch(/^UOP-[0-9A-F]{8}$/);

    // Token must be seeded in the in-memory store
    const { token } = await bluetoothCode.getToken(String(session._id));
    expect(token).toMatch(/^[0-9a-f]{16}$/);

    await bluetoothCode.removeToken(String(session._id));
  });

  test('200 — admin can enable BT for any session without course ownership', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse({ lecturers: [] });
    const session = makeSession({ course: course._id, bluetoothEnabled: false });

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/bluetooth/start`)
      .set(headers(admin));

    expect(res.status).toBe(200);
    expect(session.bluetoothEnabled).toBe(true);

    await bluetoothCode.removeToken(String(session._id));
  });
});

describe('PATCH /api/admin/sessions/:id/bluetooth/stop', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).patch(`/api/admin/sessions/${makeId()}/bluetooth/stop`).set(csrfHeader);
    expect(res.status).toBe(401);
  });

  test('200 — lecturer with course access disables BT and removes token', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({ course: course._id });

    // Pre-seed a token
    await bluetoothCode.getToken(String(session._id));

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/bluetooth/stop`)
      .set(headers(lecturer));

    expect(res.status).toBe(200);
    expect(session.bluetoothEnabled).toBe(false);
    // Token removed
    expect(await bluetoothCode.verifyToken(String(session._id), 'anytoken')).toBe(false);
  });

  test('200 — admin can stop BT for any session', async () => {
    const admin = makePerson({ role: 'admin' });
    const course = makeCourse({ lecturers: [] });
    const session = makeSession({ course: course._id });

    Person.findById.mockResolvedValue(admin);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/bluetooth/stop`)
      .set(headers(admin));

    expect(res.status).toBe(200);
    expect(session.bluetoothEnabled).toBe(false);
  });
});

// ─── bluetooth-broadcast ─────────────────────────────────────────────────────

describe('GET /api/admin/sessions/:id/bluetooth-broadcast', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get(`/api/admin/sessions/${makeId()}/bluetooth-broadcast`);
    expect(res.status).toBe(401);
  });

  test('400 when BT not enabled', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({ course: course._id, bluetoothEnabled: false });

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .get(`/api/admin/sessions/${session._id}/bluetooth-broadcast`)
      .set(headers(lecturer));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  test('200 — returns deviceName, token, rotatesIn, rotationMs for lecturer', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const course = makeCourse({ lecturers: [String(lecturer._id)] });
    const session = makeSession({ course: course._id });

    await bluetoothCode.getToken(String(session._id)); // seed

    Person.findById.mockResolvedValue(lecturer);
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .get(`/api/admin/sessions/${session._id}/bluetooth-broadcast`)
      .set(headers(lecturer));

    expect(res.status).toBe(200);
    expect(res.body.deviceName).toBe('UOP-TESTDEV1');
    expect(res.body.token).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof res.body.rotatesIn).toBe('number');
    expect(res.body.rotationMs).toBe(15000);

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
      .get(`/api/admin/sessions/${session._id}/bluetooth-broadcast`)
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

  test('400 when BT is not enabled on the session', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id, bluetoothEnabled: false });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .get(`/api/bluetooth-target?courseId=${course._id}`)
      .set(headers(student));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  test('200 — returns only deviceName when BT is enabled', async () => {
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
    expect(res.body.deviceName).toBe('UOP-TESTDEV1');
    expect(res.body.sessionId).toBeUndefined(); // not exposed
  });
});

// ─── bluetooth-attendance (student) ──────────────────────────────────────────

describe('POST /api/bluetooth-attendance', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).post('/api/bluetooth-attendance').set(csrfHeader).send({});
    expect(res.status).toBe(401);
  });

  test('403 when authenticated as admin (not student)', async () => {
    const admin = makePerson({ role: 'admin' });
    Person.findById.mockResolvedValue(admin);

    const res = await request(app)
      .post('/api/bluetooth-attendance')
      .set(headers(admin))
      .send({ courseId: makeId(), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(403);
  });

  test('400 for invalid courseId', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .post('/api/bluetooth-attendance')
      .set(headers(student))
      .send({ courseId: 'bad', token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/courseId/i);
  });

  test('400 for invalid BT token format', async () => {
    const student = makePerson({ role: 'student' });
    Person.findById.mockResolvedValue(student);

    const res = await request(app)
      .post('/api/bluetooth-attendance')
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
      .post('/api/bluetooth-attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
  });

  test('400 when BT not enabled on session', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id, bluetoothEnabled: false });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .post('/api/bluetooth-attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  test('400 when attendance is paused', async () => {
    const student = makePerson({ role: 'student' });
    const course = makeCourse();
    const session = makeSession({ course: course._id, attendancePaused: true });

    Person.findById.mockResolvedValue(student);
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    await bluetoothCode.getToken(String(session._id));

    const res = await request(app)
      .post('/api/bluetooth-attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token: 'aabbccddeeff0011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paused/i);

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
      .post('/api/bluetooth-attendance')
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
      .post('/api/bluetooth-attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.attendance.method).toBe('bluetooth');
    expect(Attendance.create).toHaveBeenCalledWith(expect.objectContaining({
      method: 'bluetooth',
      lectureCode: token,
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
      .post('/api/bluetooth-attendance')
      .set(headers(student))
      .send({ courseId: String(course._id), token });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(Attendance.create).not.toHaveBeenCalled();

    await bluetoothCode.removeToken(String(session._id));
  });
});
