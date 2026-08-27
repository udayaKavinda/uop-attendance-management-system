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

// Settings singleton — returned by reference and reset in place, so the settings
// service's 5s read-through cache always points at the live object.
const mockSettingsStore = {};
function resetSettings() {
  Object.keys(mockSettingsStore).forEach((k) => delete mockSettingsStore[k]);
  Object.assign(mockSettingsStore, {
    bleEnabled: true,
    nearBufferM: 50,
    farBufferM: 100,
    nearBufferLogic: 'accuracy_weighted_centroid',
    farBufferLogic: 'accuracy_weighted_centroid',
    seedRate: 0,
    seedWindowMs: 60000,
  });
}
resetSettings();
jest.mock('../models/Settings', () => ({
  findOneAndUpdate: jest.fn((_filter, update) => {
    if (update.$set) Object.assign(mockSettingsStore, update.$set);
    return Promise.resolve(mockSettingsStore);
  }),
}));

jest.mock('../models/Person', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/Course', () => ({ findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/LectureSession', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../models/Geofence', () => ({ find: jest.fn().mockResolvedValue([]) }));
jest.mock('../models/Attendance', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  distinct: jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
  updateOne: jest.fn().mockResolvedValue({}),
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
  return {
    _id: makeId(),
    course: makeId(),
    lectureDay: todayDay(),
    startTime: '00:00',
    endTime: '23:59',
    recurring: true,
    active: true,
    deleted: false,
    buildings: [makeId()],
    manualCodeRotationMode: 'none',
    manualCodeRotationSeconds: 60,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeCourse(overrides = {}) {
  return {
    _id: makeId(), code: 'CS101', active: true, lecturers: [], ...overrides,
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

/** Wires the session-access guard so `lecturer` owns `session`. */
function ownSession(lecturer, session) {
  const course = makeCourse({ lecturers: [lecturer._id] });
  LectureSession.findOne.mockResolvedValue(session);
  Course.findById.mockResolvedValue(course);
  return course;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockManualCodeStore).forEach((k) => delete mockManualCodeStore[k]);
  resetSettings();
  Attendance.findOne.mockResolvedValue(null);
  Attendance.create.mockImplementation((doc) => Promise.resolve({ _id: makeId(), ...doc }));
});

// ─── GET/PATCH /api/admin/settings ───────────────────────────────────────────

describe('GET/PATCH /api/admin/settings', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(401);
  });

  test('lecturers can read settings but not write them', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const getRes = await request(app).get('/api/admin/settings').set(authHeader(lecturer));
    expect(getRes.status).toBe(200);

    const patchRes = await request(app)
      .patch('/api/admin/settings')
      .set(headers(lecturer))
      .send({ bleEnabled: false });
    expect(patchRes.status).toBe(403);
  });

  test('exposes the full policy shape', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app).get('/api/admin/settings').set(authHeader(admin));
    expect(res.body).toMatchObject({
      bleEnabled: expect.any(Boolean),
      nearBufferM: expect.any(Number),
      farBufferM: expect.any(Number),
      nearBufferLogic: expect.any(String),
      farBufferLogic: expect.any(String),
      geofenceLogicOptions: expect.any(Array),
      seedRate: expect.any(Number),
      seedWindowMs: expect.any(Number),
    });
  });

  test('admin can flip the Bluetooth kill switch and it reads back immediately', async () => {
    const admin = makePerson({ role: 'admin' });

    const off = await request(app).patch('/api/admin/settings').set(headers(admin)).send({ bleEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body.bleEnabled).toBe(false);

    const after = await request(app).get('/api/admin/settings').set(authHeader(admin));
    expect(after.body.bleEnabled).toBe(false);
  });

  test('admin can move the distance buffers', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ nearBufferM: 25, farBufferM: 250 });
    expect(res.body).toMatchObject({ nearBufferM: 25, farBufferM: 250 });
  });

  test('rejects a far buffer smaller than the near buffer', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ nearBufferM: 200, farBufferM: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/farBufferM/);
  });

  test('rejects a negative or absurd buffer', async () => {
    const admin = makePerson({ role: 'admin' });
    expect((await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ nearBufferM: -1 })).status).toBe(400);
    expect((await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ farBufferM: 99999 })).status).toBe(400);
  });

  test('rejects a non-boolean switch', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ bleEnabled: 'nope' });
    expect(res.status).toBe(400);
  });

  test('admin can select the near/far buffer logic independently', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ nearBufferLogic: 'any_point_within', farBufferLogic: 'all_points_within' });
    expect(res.body).toMatchObject({
      nearBufferLogic: 'any_point_within',
      farBufferLogic: 'all_points_within',
    });
  });

  /**
   * Regression: the option list used to be appended to the GET handler only, so
   * every PATCH replied without it. The client replaces its cached settings
   * wholesale and re-reads this endpoint just once per dashboard, so a single
   * write emptied both geofence-logic dropdowns until the screen was recreated —
   * and since choosing a strategy is itself a PATCH, picking one option destroyed
   * the menu. Every settings response must carry the list.
   */
  test('every settings response carries the geofence-logic option list, writes included', async () => {
    const admin = makePerson({ role: 'admin' });
    const expectOptions = (body) => {
      expect(Array.isArray(body.geofenceLogicOptions)).toBe(true);
      expect(body.geofenceLogicOptions.length).toBeGreaterThan(1);
      body.geofenceLogicOptions.forEach((o) => {
        expect(o).toMatchObject({
          id: expect.any(String), label: expect.any(String), description: expect.any(String),
        });
      });
      // The currently-selected ids must be resolvable against the list, or the
      // dropdown cannot render its own selection.
      const ids = body.geofenceLogicOptions.map((o) => o.id);
      expect(ids).toContain(body.nearBufferLogic);
      expect(ids).toContain(body.farBufferLogic);
    };

    expectOptions((await request(app).get('/api/admin/settings').set(authHeader(admin))).body);
    // A write of the logic itself — the case that used to break the picker.
    expectOptions((await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ nearBufferLogic: 'majority_points_within' })).body);
    // ...and a write of something entirely unrelated.
    expectOptions((await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ bleEnabled: false })).body);
  });

  test('rejects an unrecognized buffer-logic strategy id', async () => {
    const admin = makePerson({ role: 'admin' });
    const res = await request(app).patch('/api/admin/settings').set(headers(admin))
      .send({ nearBufferLogic: 'made_up_strategy' });
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

  test('every running session already has a live code — no enabling step', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    ownSession(lecturer, makeSession());
    const session = await LectureSession.findOne();
    const res = await request(app).get(`/api/admin/sessions/${session._id}/manual-code`).set(authHeader(lecturer));
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(true);
    expect(res.body.code).toMatch(/^[0-9]{8}$/);
  });

  test('pausing freezes the code; resuming regenerates it with no grace on the old one', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    ownSession(lecturer, session);

    const first = await request(app).get(`/api/admin/sessions/${session._id}/manual-code`).set(authHeader(lecturer));
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
    ownSession(lecturer, session);

    const first = await request(app).get(`/api/admin/sessions/${session._id}/manual-code`).set(authHeader(lecturer));
    const regenerated = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ regenerate: true });
    expect(regenerated.body.code).not.toBe(first.body.code);
  });

  test('switching to interval rotation is accepted and reported back', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    ownSession(lecturer, session);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ rotationMode: 'interval', rotationSeconds: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rotationMode: 'interval', rotationSeconds: 30 });
  });

  test('rejects an out-of-range rotationSeconds', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    ownSession(lecturer, session);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ rotationMode: 'interval', rotationSeconds: 4 });
    expect(res.status).toBe(400);
  });

  test('rejects an enabled flag — the field no longer exists', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const session = makeSession();
    ownSession(lecturer, session);

    const res = await request(app)
      .patch(`/api/admin/sessions/${session._id}/manual-code`)
      .set(headers(lecturer))
      .send({ enabled: true });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/attendance (student "get help" submission) ─────────────────────

describe('POST /api/attendance — code submission', () => {
  test('401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/attendance')
      .set(csrfHeader)
      .send({ courseId: makeId(), code: '12345678' });
    expect(res.status).toBe(401);
  });

  test('400 for a malformed code', async () => {
    const student = makePerson({ role: 'student' });
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: makeId(), code: '123' });
    expect(res.status).toBe(400);
  });

  test('400 when the course has no session running now', async () => {
    const student = makePerson({ role: 'student' });
    Course.findById.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: makeId(), code: '12345678' });
    expect(res.status).toBe(400);
  });

  test('a correct code with no location evidence is flagged, and refreshes rather than duplicating', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const student = makePerson({ role: 'student' });
    const session = makeSession();
    const course = ownSession(lecturer, session);

    const staffRes = await request(app)
      .get(`/api/admin/sessions/${session._id}/manual-code`)
      .set(authHeader(lecturer));
    const { code } = staffRes.body;
    expect(code).toMatch(/^[0-9]{8}$/);

    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: course._id, code });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'code_override', status: 'flagged' }),
    );

    // Resubmitting refreshes the existing flagged row rather than creating a second one.
    Attendance.create.mockClear();
    const existing = {
      _id: 'existing-att', status: 'flagged', save: jest.fn().mockResolvedValue(undefined),
    };
    Attendance.findOne.mockResolvedValue(existing);
    const repeat = await request(app)
      .post('/api/attendance')
      .set(headers(student))
      .send({ courseId: course._id, code });
    expect(repeat.body).toMatchObject({ status: 'flagged', duplicate: true });
    expect(existing.save).toHaveBeenCalled();
    expect(Attendance.create).not.toHaveBeenCalled();
  });

  test('rejects a wrong code every time — no attempt cap or lockout', async () => {
    const lecturer = makePerson({ role: 'lecturer' });
    const student = makePerson({ role: 'student' });
    const session = makeSession();
    const course = ownSession(lecturer, session);

    await request(app).get(`/api/admin/sessions/${session._id}/manual-code`).set(authHeader(lecturer));
    LectureSession.find.mockResolvedValue([session]);

    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/attendance')
        .set(headers(student))
        .send({ courseId: course._id, code: '00000000' });
      expect(res.status).toBe(400);
    }
  });
});

// Note: there is no lecturer review queue anymore — a far/unknown code
// submission is written as a `flagged` Attendance record directly (see the
// "get help" describe block above) and surfaces only in the Excel export
// (server/src/tests/attendanceExport.service.test.js), never through an
// approve/reject endpoint.
