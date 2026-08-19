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
  findOneAndUpdate: jest.fn((filter, update) => {
    const doc = { ...(mockBleTokenStore[filter.sessionId] || {}), ...filter, ...update };
    mockBleTokenStore[filter.sessionId] = doc;
    return Promise.resolve(doc);
  }),
  deleteMany: jest.fn(({ sessionId }) => {
    delete mockBleTokenStore[sessionId];
    return Promise.resolve({ deletedCount: 1 });
  }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: jest.fn(() => Promise.resolve(0)),
}));

// Returned by reference (not copied) so a test can flip a switch mid-file and
// have it take effect through the settings service's 5s read-through cache.
// resetSettings() mutates in place for the same reason — reassigning would leave
// the service's cache pointing at the previous object.
const mockSettingsStore = {};
function resetSettings() {
  Object.keys(mockSettingsStore).forEach((k) => delete mockSettingsStore[k]);
  Object.assign(mockSettingsStore, {
    bleEnabled: true,
    nearBufferM: 50,
    farBufferM: 100,
    suspiciousBandAutoPass: true,
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

let mockGeofenceStore = [];
jest.mock('../models/Geofence', () => ({
  find: jest.fn(({ _id, active }) => {
    const ids = _id?.$in?.map(String) || [];
    return Promise.resolve(mockGeofenceStore.filter(
      (g) => ids.includes(String(g._id)) && !g.deleted && (active !== true || g.active === true),
    ));
  }),
}));

let mockManualCodeDoc = null;
jest.mock('../models/ManualCode', () => ({
  findOne: jest.fn(() => Promise.resolve(mockManualCodeDoc)),
  findOneAndUpdate: jest.fn(() => Promise.resolve(mockManualCodeDoc)),
  deleteOne: jest.fn(),
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

const request = require('supertest');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');

const app = require('../app');

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function todayDay() { return DAY_NAMES[new Date().getDay()]; }
function makeId() { return new mongoose.Types.ObjectId().toHexString(); }

// ~110m square near Colombo, used as the session's single building.
const SQUARE = [[79.8000, 6.9000], [79.8010, 6.9000], [79.8010, 6.9010], [79.8000, 6.9010]];
const INSIDE = { lat: 6.9005, lng: 79.8005, accuracy: 5 };
const SUSPICIOUS = { lat: 6.8993, lng: 79.8005, accuracy: 5 }; // ~78m south
const FAR = { lat: 6.8900, lng: 79.8005, accuracy: 5 }; // >1km south

function addBuilding() {
  const geofenceId = makeId();
  mockGeofenceStore.push({
    _id: geofenceId, polygon: SQUARE, active: true, deleted: false,
  });
  return geofenceId;
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
    buildings: [],
    manualCodeRotationMode: 'none',
    manualCodeRotationSeconds: 60,
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

/** Streams `count` identical fixes, returning the last response. */
async function streamFixes(student, courseId, fix, count = 4) {
  let last;
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await request(app).post('/api/attendance').set(headers(student)).send({ courseId, fix });
  }
  return last;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockBleTokenStore).forEach((k) => delete mockBleTokenStore[k]);
  mockGeofenceStore = [];
  mockManualCodeDoc = null;
  resetSettings();
  Attendance.findOne.mockResolvedValue(null);
  Attendance.create.mockImplementation((doc) => Promise.resolve({ _id: makeId(), ...doc }));
});

describe('POST /api/attendance — validation', () => {
  test('400 when none of token/fix/code are present', async () => {
    const res = await request(app).post('/api/attendance').set(headers(makePerson())).send({ courseId: makeId() });
    expect(res.status).toBe(400);
  });

  test('400 when more than one of token/fix/code are present', async () => {
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(makePerson()))
      .send({ courseId: makeId(), token: 'a'.repeat(16), code: '12345678' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/attendance — GPS band decisions', () => {
  test('accepts a student standing inside the building polygon', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const first = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, fix: INSIDE });
    expect(first.body.status).toBe('collecting');

    const last = await streamFixes(student, course._id, INSIDE, 3);
    expect(last.status).toBe(200);
    expect(last.body.status).toBe('accepted');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'gps', status: 'present', band: 'inside' }),
    );
  });

  test('accepts a student within the near buffer of the building', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const last = await streamFixes(student, course._id, { lat: 6.8997, lng: 79.8005, accuracy: 5 });
    expect(last.body.status).toBe('accepted');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'gps', status: 'present', band: 'near' }),
    );
  });

  test('a suspicious-band student is told only "collecting" — never their band', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const last = await streamFixes(student, course._id, SUSPICIOUS);
    expect(last.status).toBe(200);
    expect(last.body).toEqual({ status: 'collecting' });
    expect(Attendance.create).not.toHaveBeenCalled();
  });

  test('a far-band student is indistinguishable from a suspicious one over the wire', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const last = await streamFixes(student, course._id, FAR);
    expect(last.body).toEqual({ status: 'collecting' });
    expect(Attendance.create).not.toHaveBeenCalled();
  });

  test('does not accept a centroid built only from very inaccurate fixes', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()] });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const last = await streamFixes(student, course._id, { ...INSIDE, accuracy: 300 });
    expect(last.body).toEqual({ status: 'collecting' });
    expect(Attendance.create).not.toHaveBeenCalled();
  });

  test('keeps collecting when every referenced building has been deactivated', async () => {
    const student = makePerson();
    const geofenceId = makeId();
    mockGeofenceStore.push({
      _id: geofenceId, polygon: SQUARE, active: false, deleted: false,
    });
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([makeSession({ buildings: [geofenceId] })]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, fix: INSIDE });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('collecting');
  });
});

describe('POST /api/attendance — Bluetooth path', () => {
  function liveBleSession() {
    const session = makeSession({
      buildings: [addBuilding()],
      broadcasting: true,
      lastBroadcastSeenAt: new Date(),
    });
    mockBleTokenStore[String(session._id)] = {
      sessionId: String(session._id),
      role: 'primary',
      token: 'abcdef1234567890',
      prevToken: null,
      generatedAt: Date.now(),
    };
    return session;
  }

  test('accepts a valid primary token outright, without any GPS', async () => {
    const student = makePerson();
    const session = liveBleSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, token: 'abcdef1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'bluetooth', status: 'present', band: 'inside', seedRelayed: false }),
    );
  });

  test('rejects an unknown token', async () => {
    const student = makePerson();
    const session = liveBleSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, token: 'f'.repeat(16) });
    expect(res.status).toBe(400);
  });

  test('rejects a Bluetooth submission while the global kill switch is off', async () => {
    mockSettingsStore.bleEnabled = false;
    const student = makePerson();
    const session = liveBleSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, token: 'abcdef1234567890' });
    expect(res.status).toBe(403);
  });

  test('marks attendance relayed when the token came from a peer seeder', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()], broadcasting: true, lastBroadcastSeenAt: new Date() });
    mockBleTokenStore[String(session._id)] = {
      sessionId: String(session._id),
      role: 'seed',
      token: 'abcdef1234567890',
      prevToken: null,
      generatedAt: Date.now(),
      leaseUntil: Date.now() + 60_000,
    };
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, token: 'abcdef1234567890' });
    expect(res.body.status).toBe('accepted');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'bluetooth', seedRelayed: true }),
    );
  });
});

describe('POST /api/attendance — "get help" lecturer code', () => {
  function codeSession() {
    mockManualCodeDoc = {
      code: '11112222', prevCode: null, generatedAt: Date.now(), paused: false,
    };
    return makeSession({ buildings: [addBuilding()] });
  }

  test('rejects a wrong code', async () => {
    const student = makePerson();
    const session = codeSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, code: '99998888' });
    expect(res.status).toBe(400);
    expect(Attendance.create).not.toHaveBeenCalled();
  });

  test('a correct code from the suspicious band passes outright by default', async () => {
    const student = makePerson();
    const session = codeSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    await streamFixes(student, course._id, SUSPICIOUS);
    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, code: '11112222' });

    expect(res.body.status).toBe('accepted');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'code_override', status: 'present', band: 'suspicious' }),
    );
  });

  test('the admin can send the suspicious band to review instead of passing it', async () => {
    mockSettingsStore.suspiciousBandAutoPass = false;
    const student = makePerson();
    const session = codeSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    await streamFixes(student, course._id, SUSPICIOUS);
    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, code: '11112222' });

    expect(res.body.status).toBe('under_review');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'code_override', status: 'under_review', band: 'suspicious' }),
    );
  });

  test('a correct code from beyond the far buffer only reaches lecturer review', async () => {
    const student = makePerson();
    const session = codeSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    await streamFixes(student, course._id, FAR);
    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, code: '11112222' });

    expect(res.body.status).toBe('under_review');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'under_review', band: 'far' }),
    );
  });

  test('a correct code with no GPS evidence at all reaches review, never a pass', async () => {
    const student = makePerson();
    const session = codeSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, code: '11112222' });

    expect(res.body.status).toBe('under_review');
    expect(Attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'under_review', band: 'unknown' }),
    );
  });

  test('a student who already passed automatically keeps that record if they submit a code anyway', async () => {
    const student = makePerson();
    const session = codeSession();
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    await streamFixes(student, course._id, INSIDE);
    Attendance.create.mockClear();
    // The GPS pass above wrote a present record; the code path now finds it.
    Attendance.findOne.mockResolvedValue({ _id: makeId(), status: 'present' });

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, code: '11112222' });
    expect(res.body).toMatchObject({ status: 'accepted', duplicate: true });
    expect(Attendance.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/attendance — idempotency and upgrades', () => {
  test('a second submission returns the existing record rather than creating another', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()], broadcasting: true, lastBroadcastSeenAt: new Date() });
    mockBleTokenStore[String(session._id)] = {
      sessionId: String(session._id), role: 'primary', token: 'abcdef1234567890', prevToken: null, generatedAt: Date.now(),
    };
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);
    Attendance.findOne.mockResolvedValue({ _id: makeId(), status: 'present' });

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, token: 'abcdef1234567890' });
    expect(res.body).toMatchObject({ status: 'accepted', duplicate: true });
    expect(Attendance.create).not.toHaveBeenCalled();
  });

  test('a genuine Bluetooth pass upgrades an existing under-review record', async () => {
    const student = makePerson();
    const session = makeSession({ buildings: [addBuilding()], broadcasting: true, lastBroadcastSeenAt: new Date() });
    mockBleTokenStore[String(session._id)] = {
      sessionId: String(session._id), role: 'primary', token: 'abcdef1234567890', prevToken: null, generatedAt: Date.now(),
    };
    const course = makeCourse();
    Course.findById.mockResolvedValue(course);
    LectureSession.find.mockResolvedValue([session]);

    const pending = {
      _id: makeId(), status: 'under_review', save: jest.fn().mockResolvedValue(undefined),
    };
    Attendance.findOne.mockResolvedValue(pending);

    const res = await request(app).post('/api/attendance').set(headers(student))
      .send({ courseId: course._id, token: 'abcdef1234567890' });

    expect(pending.status).toBe('present');
    expect(pending.save).toHaveBeenCalled();
    expect(res.body.status).toBe('accepted');
  });
});

describe('GET /api/attendance/seed-token', () => {
  test('400 for an invalid sessionId', async () => {
    const res = await request(app).get('/api/attendance/seed-token?sessionId=not-an-id').set(authHeader(makePerson()));
    expect(res.status).toBe(400);
  });

  test('404 when the session does not exist', async () => {
    LectureSession.findOne.mockResolvedValue(null);
    const res = await request(app).get(`/api/attendance/seed-token?sessionId=${makeId()}`).set(authHeader(makePerson()));
    expect(res.status).toBe(404);
  });

  test('400 once the seeding lease has ended (no live seed row)', async () => {
    const session = makeSession();
    LectureSession.findOne.mockResolvedValue(session);
    const res = await request(app).get(`/api/attendance/seed-token?sessionId=${session._id}`).set(authHeader(makePerson()));
    expect(res.status).toBe(400);
  });

  test('403 while Bluetooth is globally killed', async () => {
    mockSettingsStore.bleEnabled = false;
    const session = makeSession();
    LectureSession.findOne.mockResolvedValue(session);
    const res = await request(app).get(`/api/attendance/seed-token?sessionId=${session._id}`).set(authHeader(makePerson()));
    expect(res.status).toBe(403);
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
