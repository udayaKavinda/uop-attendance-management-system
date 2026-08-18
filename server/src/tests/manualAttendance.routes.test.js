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

// ManualCode in-memory store — lets manualCode.service work without a real MongoDB connection
const mockManualCodeStore = {};
jest.mock('../models/ManualCode', () => ({
  findOne: jest.fn(({ session }) => Promise.resolve(mockManualCodeStore[session] ?? null)),
  findOneAndUpdate: jest.fn(({ session }, update) => {
    const doc = { ...(mockManualCodeStore[session] || {}), session, ...update };
    mockManualCodeStore[session] = doc;
    return Promise.resolve(doc);
  }),
  deleteOne: jest.fn(({ session }) => {
    delete mockManualCodeStore[session];
    return Promise.resolve({ deletedCount: 1 });
  }),
}));

// Settings singleton in-memory store
let mockSettingsStore = null;
jest.mock('../models/Settings', () => ({
  findOneAndUpdate: jest.fn((_filter, update) => {
    // Upsert-on-missing (covers both the plain read path's $setOnInsert and the write path's $set).
    if (!mockSettingsStore) mockSettingsStore = { manualCodeAllowed: true };
    if (update.$set) Object.assign(mockSettingsStore, update.$set);
    return Promise.resolve({ ...mockSettingsStore });
  }),
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

const request = require('supertest');
const mongoose = require('mongoose');

const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');

const app = require('../app');

// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function todayDay() {
  return DAY_NAMES[new Date().getDay()];
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
    manualCodeEnabled: false,
    manualCodeRotationMode: 'none',
    manualCodeRotationSeconds: 60,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeCourse(overrides = {}) {
  const id = makeId();
  return {
    _id: id, code: 'CS101', active: true, lecturers: [], ...overrides,
  };
}

function makePerson(overrides = {}) {
  return {
    _id: makeId(), email: 'test@example.com', role: 'student', deleted: false, ...overrides,
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
  Object.keys(mockManualCodeStore).forEach((k) => delete mockManualCodeStore[k]);
  mockSettingsStore = null;
});

// ─── GET/PATCH /api/admin/settings (global kill-switch) ──────────────────────

describe('GET/PATCH /api/admin/settings', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(401);
  });

  test('lecturers can read settings (needed for the create-session mode picker) but not write them', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const getRes = await request(app).get('/api/admin/settings').set(authHeader(lecturer));
    expect(getRes.status).toBe(200);

    const patchRes = await request(app)
      .patch('/api/admin/settings')
      .set(headers(lecturer))
      .send({ manualCodeAllowed: false });
    expect(patchRes.status).toBe(403);
  });

  test('admin can read and update settings; the kill-switch takes effect immediately', async () => {
    const admin = makePerson({ role: 'admin' });

    const initial = await request(app).get('/api/admin/settings').set(authHeader(admin));
    expect(initial.status).toBe(200);
    expect(typeof initial.body.manualCodeAllowed).toBe('boolean');

    const patchOff = await request(app)
      .patch('/api/admin/settings')
      .set(headers(admin))
      .send({ manualCodeAllowed: false });
    expect(patchOff.status).toBe(200);
    expect(patchOff.body.manualCodeAllowed).toBe(false);

    const getAfterOff = await request(app).get('/api/admin/settings').set(authHeader(admin));
    expect(getAfterOff.body.manualCodeAllowed).toBe(false);

    // Restore for the describe blocks that follow.
    const patchOn = await request(app)
      .patch('/api/admin/settings')
      .set(headers(admin))
      .send({ manualCodeAllowed: true });
    expect(patchOn.body.manualCodeAllowed).toBe(true);
  });

  test('rejects a non-boolean manualCodeAllowed', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app)
      .patch('/api/admin/settings')
      .set(headers(admin))
      .send({ manualCodeAllowed: 'nope' });
    expect(res.status).toBe(400);
  });
});

// ─── GET/PATCH /api/admin/sessions/:id/manual-code ────────────────────────────

describe('GET/PATCH /api/admin/sessions/:id/manual-code', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get(`/api/admin/sessions/${makeId()}/manual-code`);
    expect(res.status).toBe(401);
  });

  test('404 when session does not exist', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    LectureSession.findOne.mockResolvedValue(null);
    const res = await request(app).get(`/api/admin/sessions/${makeId()}/manual-code`).set(authHeader(lecturer));
    expect(res.status).toBe(404);
  });

  test('403 when the lecturer is not assigned to the course', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(makeCourse({ lecturers: [] }));
    const res = await request(app).get(`/api/admin/sessions/${session._id}/manual-code`).set(authHeader(lecturer));
    expect(res.status).toBe(403);
  });

  test('reports disabled by default', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    const course = makeCourse({ lecturers: [lecturer._id] });
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);
    const res = await request(app).get(`/api/admin/sessions/${session._id}/manual-code`).set(authHeader(lecturer));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, code: null, allowed: true });
  });

  test('enabling seeds a fresh code while the session is running', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    const course = makeCourse({ lecturers: [lecturer._id] });
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.running).toBe(true);
    expect(res.body.code).toMatch(/^[0-9]{8}$/);
  });

  test('pausing freezes the code; resuming regenerates it with no grace on the old one', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    const course = makeCourse({ lecturers: [lecturer._id] });
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const first = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });
    const firstCode = first.body.code;

    const paused = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ paused: true });
    expect(paused.body.paused).toBe(true);
    expect(paused.body.code).toBe(firstCode);

    const resumed = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ paused: false });
    expect(resumed.body.paused).toBe(false);
    expect(resumed.body.code).not.toBe(firstCode);
  });

  test('regenerate forces a new code immediately', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    const course = makeCourse({ lecturers: [lecturer._id] });
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const first = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });

    const regenerated = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ regenerate: true });
    expect(regenerated.body.code).not.toBe(first.body.code);
  });

  test('rejects enabling when the global switch is off', async () => {
    const admin = makePerson({ role: 'admin' });
    await request(app).patch('/api/admin/settings').set(headers(admin)).send({ manualCodeAllowed: false });

    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    const course = makeCourse({ lecturers: [lecturer._id] });
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });
    expect(res.status).toBe(403);

    // Restore for the describe block that follows.
    await request(app).patch('/api/admin/settings').set(headers(admin)).send({ manualCodeAllowed: true });
  });

  test('rejects an out-of-range rotationSeconds', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    const course = makeCourse({ lecturers: [lecturer._id] });
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ rotationMode: 'interval', rotationSeconds: 4 });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/manual-attendance (student submission) ─────────────────────────

describe('POST /api/manual-attendance', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/manual-attendance')
      .set(csrfHeader)
      .send({ courseId: makeId(), code: '12345678' });
    expect(res.status).toBe(401);
  });

  test('400 for a malformed code', async () => {
    const student = makePerson({ role: 'student' });
    const res = await request(app)
      .post('/api/manual-attendance')
      .set(headers(student))
      .send({ courseId: makeId(), code: '123' });
    expect(res.status).toBe(400);
  });

  test('400 when the course has no session running now', async () => {
    const student = makePerson({ role: 'student' });
    Course.findById.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/manual-attendance')
      .set(headers(student))
      .send({ courseId: makeId(), code: '12345678' });
    expect(res.status).toBe(400);
  });

  test('400 when manual code is not enabled for the running session', async () => {
    const student = makePerson({ role: 'student' });
    const session = makeSession({ manualCodeEnabled: false });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .post('/api/manual-attendance')
      .set(headers(student))
      .send({ courseId: course._id, code: '12345678' });
    expect(res.status).toBe(400);
  });

  test('records attendance on a correct code and is idempotent on repeat submission', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const student = makePerson({ role: 'student' });
    const session = makeSession({ manualCodeEnabled: true, manualCodeRotationMode: 'none' });
    const course = makeCourse({ lecturers: [lecturer._id] });

    // Staff enables + reveals the code — mirrors the real workflow (lecturer turns
    // it on and reads it out to the room).
    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);
    const staffRes = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });
    const code = staffRes.body.code;
    expect(code).toMatch(/^[0-9]{8}$/);

    // Student submits it.
    LectureSession.find.mockResolvedValue([session]);
    Attendance.findOne.mockResolvedValue(null);
    Attendance.create.mockResolvedValue({ _id: makeId(), method: 'manual_code' });

    const res = await request(app)
      .post('/api/manual-attendance')
      .set(headers(student))
      .send({ courseId: course._id, code });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Attendance.create).toHaveBeenCalledWith(expect.objectContaining({ method: 'manual_code' }));

    // Repeat submission resolves to the existing record instead of erroring.
    Attendance.findOne.mockResolvedValue({ _id: 'existing-att' });
    const repeat = await request(app)
      .post('/api/manual-attendance')
      .set(headers(student))
      .send({ courseId: course._id, code });
    expect(repeat.status).toBe(200);
    expect(repeat.body.duplicate).toBe(true);
  });

  test('rejects a wrong code repeatedly and locks the student out after 5 attempts', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const student = makePerson({ role: 'student' });
    const session = makeSession({ manualCodeEnabled: true, manualCodeRotationMode: 'none' });
    const course = makeCourse({ lecturers: [lecturer._id] });

    LectureSession.findOne.mockResolvedValue(session);
    Course.findById.mockResolvedValue(course);
    await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });

    LectureSession.find.mockResolvedValue([session]);

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/manual-attendance')
        .set(headers(student))
        .send({ courseId: course._id, code: '00000000' });
      expect(res.status).toBe(400);
    }

    const lockedRes = await request(app)
      .post('/api/manual-attendance')
      .set(headers(student))
      .send({ courseId: course._id, code: '00000000' });
    expect(lockedRes.status).toBe(429);
  });
});
