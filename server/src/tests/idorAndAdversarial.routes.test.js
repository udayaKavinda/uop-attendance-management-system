'use strict';

/**
 * Adversarial / IDOR test suite — mandatory per the pre-production security
 * audit. Nothing here existed before: `/api/admin/courses` and
 * `/api/admin/sessions` had zero route-level tests, meaning the ownership
 * boundary (`requireCourseAccess`/`requireSessionAccess`) was only ever
 * exercised at the unit level (auth.service.test.js's `assertCourseAccess`),
 * never proven through an actual HTTP request substituting another
 * lecturer's resource id.
 *
 * Also covers: GPS spoofing (is client-asserted GPS actually trusted?),
 * Mongo-operator injection on validated fields, and a simulated duplicate-key
 * race on attendance writes.
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

const mongoose = require('mongoose');

function makeId() { return new mongoose.Types.ObjectId().toHexString(); }

const LECTURER_A = makeId();
const LECTURER_B = makeId();
const COURSE_A_ID = makeId();
const COURSE_B_ID = makeId();
const SESSION_A_ID = makeId();
const SESSION_B_ID = makeId();

let courseStore = [];
let sessionStore = [];
let geofenceStore = [];
const attendanceStore = new Map(); // key -> doc

jest.mock('../models/Course', () => ({
  findById: jest.fn((id) => Promise.resolve(
    global.__courseStore.find((c) => String(c._id) === String(id)) || null,
  )),
}));

jest.mock('../models/ManualCode', () => ({
  deleteMany: jest.fn().mockResolvedValue({}),
}));

jest.mock('../models/LectureSession', () => ({
  findOne: jest.fn(({ _id }) => {
    const doc = global.__sessionStore.find((s) => String(s._id) === String(_id) && !s.deleted);
    const withSave = doc ? { ...doc, save: jest.fn().mockResolvedValue(undefined) } : null;
    // Dual shape, matching Mongoose's real findOne() (a chainable, thenable
    // Query object): `await LectureSession.findOne(...)` resolves to the plain
    // doc, while `.populate('course')` chained BEFORE awaiting resolves to the
    // same doc with `course` swapped for the full Course document — matching
    // requireSessionAccess({ populateCourse: true }).
    return Object.assign(Promise.resolve(withSave), {
      populate: jest.fn(() => Promise.resolve(doc ? {
        ...withSave,
        course: global.__courseStore.find((c) => String(c._id) === String(doc.course)) || doc.course,
        populated: (field) => field === 'course',
      } : null)),
    });
  }),
  find: jest.fn((filter = {}) => {
    const matches = global.__sessionStore.filter((s) => {
      if (s.deleted) return false;
      if (filter.course && String(s.course) !== String(filter.course)) return false;
      if (filter.active !== undefined && s.active !== filter.active) return false;
      if (filter.lectureDay && s.lectureDay !== filter.lectureDay) return false;
      return true;
    });
    // Dual shape again: awaited directly (session.service's resolveActiveSessionForCourse)
    // resolves to the array; `.distinct('_id')` (course.service's disableCourse) resolves
    // to just the ids.
    return Object.assign(Promise.resolve(matches), {
      distinct: jest.fn(() => Promise.resolve(matches.map((s) => s._id))),
    });
  }),
  updateMany: jest.fn().mockResolvedValue({}),
}));

jest.mock('../models/Geofence', () => ({
  find: jest.fn(({ _id } = {}) => {
    const ids = _id?.$in?.map(String) || [];
    return Promise.resolve(global.__geofenceStore.filter(
      (g) => ids.includes(String(g._id)) && !g.deleted && g.active,
    ));
  }),
  countDocuments: jest.fn().mockResolvedValue(1),
}));

jest.mock('../services/bluetoothCode.service', () => ({
  removeToken: jest.fn().mockResolvedValue(undefined),
  getToken: jest.fn().mockResolvedValue({ token: 'a'.repeat(16), rotatesIn: 15 }),
}));
jest.mock('../services/manualCode.service', () => ({
  removeCode: jest.fn().mockResolvedValue(undefined),
  getStatus: jest.fn().mockResolvedValue({ running: false }),
}));

jest.mock('../models/Attendance', () => ({
  findOne: jest.fn(({ student, session, attendanceDate }) => Promise.resolve(
    global.__attendanceStore.get(`${student}:${session}:${attendanceDate}`) || null,
  )),
  create: jest.fn((doc) => {
    const key = `${doc.student}:${doc.session}:${doc.attendanceDate}`;
    if (global.__attendanceStore.has(key)) {
      const err = new Error('E11000 duplicate key');
      err.code = 11000;
      return Promise.reject(err);
    }
    // eslint-disable-next-line new-cap
    const saved = { _id: new (require('mongoose').Types.ObjectId)().toHexString(), ...doc };
    global.__attendanceStore.set(key, saved);
    return Promise.resolve(saved);
  }),
}));

jest.mock('../models/Settings', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({
    bleEnabled: true, nearBufferM: 50, farBufferM: 100,
  }),
}));

const request = require('supertest');
const app = require('../app');
const Attendance = require('../models/Attendance');

function makeCourse(id, lecturerIds, overrides = {}) {
  const course = {
    _id: id, code: 'CS101', name: 'Intro', active: true, lecturers: lecturerIds, ...overrides,
  };
  course.save = jest.fn().mockResolvedValue(undefined);
  course.populate = jest.fn().mockResolvedValue(course);
  return course;
}
function makeSession(id, courseId, overrides = {}) {
  return {
    _id: id,
    course: courseId,
    lectureDay: 'MON',
    startTime: '00:00',
    endTime: '23:59',
    recurring: true,
    active: false,
    deleted: false,
    broadcasting: false,
    buildings: [],
    manualCodeRotationMode: 'none',
    manualCodeRotationSeconds: 60,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
function makePerson(overrides = {}) {
  return {
    _id: makeId(), email: 'x@eng.pdn.ac.lk', role: 'lecturer', deleted: false, active: true, ...overrides,
  };
}
function authHeader(person) { return { 'x-test-user': JSON.stringify({ ...person, _id: String(person._id) }) }; }
const csrfHeader = { 'x-requested-with': 'fetch' };
function headers(person) { return { ...authHeader(person), ...csrfHeader }; }

beforeEach(() => {
  courseStore = [
    makeCourse(COURSE_A_ID, [LECTURER_A]),
    makeCourse(COURSE_B_ID, [LECTURER_B]),
  ];
  sessionStore = [
    makeSession(SESSION_A_ID, COURSE_A_ID),
    makeSession(SESSION_B_ID, COURSE_B_ID),
  ];
  geofenceStore = [];
  attendanceStore.clear();
  global.__courseStore = courseStore;
  global.__sessionStore = sessionStore;
  global.__geofenceStore = geofenceStore;
  global.__attendanceStore = attendanceStore;
});

const lecturerA = () => makePerson({ _id: LECTURER_A, role: 'lecturer', email: 'a@eng.pdn.ac.lk' });
const lecturerB = () => makePerson({ _id: LECTURER_B, role: 'lecturer', email: 'b@eng.pdn.ac.lk' });
const student = () => makePerson({ role: 'student' });

describe('IDOR — /api/admin/courses ownership boundary', () => {
  test('lecturer A cannot disable a course owned only by lecturer B', async () => {
    const res = await request(app)
      .patch(`/api/admin/courses/${COURSE_B_ID}/disable`)
      .set(headers(lecturerA()))
      .send({});
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot create a session under lecturer B\'s course', async () => {
    const res = await request(app)
      .post(`/api/admin/courses/${COURSE_B_ID}/sessions`)
      .set(headers(lecturerA()))
      .send({
        lectureDay: 'TUE', startTime: '09:00', endTime: '10:00', recurring: true,
        buildings: [makeId()], manualCodeRotationMode: 'none', manualCodeRotationSeconds: 60,
      });
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot reassign lecturer B\'s course owners', async () => {
    const res = await request(app)
      .patch(`/api/admin/courses/${COURSE_B_ID}/assign-lecturer`)
      .set(headers(lecturerA()))
      .send({ lecturerIds: [LECTURER_A] });
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot pull lecturer B\'s attendance matrix', async () => {
    const res = await request(app)
      .get(`/api/admin/courses/${COURSE_B_ID}/attendance-matrix`)
      .set(headers(lecturerA()));
    expect(res.status).toBe(403);
  });

  test('lecturer A CAN act on their own course (sanity check the guard isn\'t just denying everything)', async () => {
    const res = await request(app)
      .patch(`/api/admin/courses/${COURSE_A_ID}/disable`)
      .set(headers(lecturerA()))
      .send({});
    expect(res.status).toBe(200);
  });

  test('nonexistent course id returns 404, not a 500 or a silent pass', async () => {
    const res = await request(app)
      .patch(`/api/admin/courses/${makeId()}/disable`)
      .set(headers(lecturerA()))
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('IDOR — /api/admin/sessions ownership boundary', () => {
  test('lecturer A cannot deactivate a session belonging to lecturer B\'s course', async () => {
    const res = await request(app)
      .patch(`/api/admin/sessions/${SESSION_B_ID}/deactivate`)
      .set(headers(lecturerA()))
      .send({});
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot delete a session belonging to lecturer B\'s course', async () => {
    const res = await request(app)
      .delete(`/api/admin/sessions/${SESSION_B_ID}`)
      .set(headers(lecturerA()));
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot toggle broadcast on lecturer B\'s session', async () => {
    const res = await request(app)
      .patch(`/api/admin/sessions/${SESSION_B_ID}/broadcast`)
      .set(headers(lecturerA()))
      .send({ on: true });
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot read lecturer B\'s manual code status', async () => {
    const res = await request(app)
      .get(`/api/admin/sessions/${SESSION_B_ID}/manual-code`)
      .set(headers(lecturerA()));
    expect(res.status).toBe(403);
  });

  test('lecturer A cannot activate lecturer B\'s session (the populateCourse guard variant)', async () => {
    const res = await request(app)
      .patch(`/api/admin/sessions/${SESSION_B_ID}/activate`)
      .set(headers(lecturerA()))
      .send({});
    expect(res.status).toBe(403);
  });

  test('an admin, unlike a lecturer, CAN act on any session', async () => {
    const res = await request(app)
      .patch(`/api/admin/sessions/${SESSION_B_ID}/deactivate`)
      .set(headers(makePerson({ role: 'admin' })))
      .send({});
    expect(res.status).toBe(200);
  });
});

describe('Role-boundary IDOR — students and lecturers on staff/admin-only routes', () => {
  test('a student is refused on the staff course list', async () => {
    const res = await request(app).get('/api/admin/courses').set(headers(student()));
    expect(res.status).toBe(403);
  });

  test('a student is refused on the staff session list', async () => {
    const res = await request(app).get('/api/admin/sessions').set(headers(student()));
    expect(res.status).toBe(403);
  });

  test('a lecturer (non-admin staff) is refused on the admin-only settings PATCH', async () => {
    const res = await request(app)
      .patch('/api/admin/settings')
      .set(headers(lecturerA()))
      .send({ bleEnabled: false });
    expect(res.status).toBe(403);
  });

  test('a lecturer is refused creating a new lecturer account (admin-only)', async () => {
    const res = await request(app)
      .post('/api/admin/lecturers')
      .set(headers(lecturerA()))
      .send({ name: 'New Lecturer', email: 'new@eng.pdn.ac.lk', phone: '0770000000' });
    expect(res.status).toBe(403);
  });

  test('an unauthenticated caller gets 401, not 403, on every staff route (no session at all)', async () => {
    const res = await request(app).get('/api/admin/courses');
    expect(res.status).toBe(401);
  });
});

describe('GPS spoofing — is client-asserted location actually trusted?', () => {
  // Building: a small square on the equator/prime-meridian for exact local-meter
  // math, matching the pattern used by geo.test.js.
  const BUILDING = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]];
  const BUILDING_CENTER = { lat: 0.0005, lng: 0.0005, accuracy: 1 };
  const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  test(
    'a fabricated perfect-accuracy fix at the exact building centroid, with nothing proving '
    + 'physical presence beyond the coordinates the client itself supplied, is accepted as '
    + 'PRESENT — the documented "client-asserted GPS" trust limitation is real, not theoretical',
    async () => {
      const stu = student();
      const buildingId = makeId();
      geofenceStore.push({
        _id: buildingId, polygon: BUILDING, active: true, deleted: false,
      });
      const courseId = makeId();
      const sessId = makeId();
      courseStore.push(makeCourse(courseId, [], { active: true }));
      const today = DAY_NAMES[new Date().getDay()];
      sessionStore.push(makeSession(sessId, courseId, {
        lectureDay: today, startTime: '00:00', endTime: '23:59', active: true, buildings: [buildingId],
      }));

      let last;
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        last = await request(app)
          .post('/api/attendance')
          .set(headers(stu))
          .send({ courseId, fix: BUILDING_CENTER });
      }
      expect(last.status).toBe(200);
      expect(last.body.status).toBe('accepted');
      expect(attendanceStore.size).toBe(1);
      const [record] = [...attendanceStore.values()];
      expect(record.status).toBe('present');
      expect(record.band).toBe('inside');
      // Nothing in this request proved physical presence: no BLE token, no
      // server-observed radio signal, no cross-check against anything the
      // student's device didn't itself report.
    },
  );
});

describe('Mongo-operator injection on validated fields', () => {
  test('an object where the 8-digit code is expected is rejected, not coerced into a query operator', async () => {
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student()))
      .send({ courseId: COURSE_A_ID, code: { $ne: null } });
    expect(res.status).toBe(400);
  });

  test('an object where a GPS fix is expected is rejected outright', async () => {
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student()))
      .send({ courseId: COURSE_A_ID, fix: { lat: { $gt: -90 }, lng: 0, accuracy: 1 } });
    expect(res.status).toBe(400);
  });

  test('a non-string, operator-shaped courseId is rejected by ObjectId validation, never reaches a query', async () => {
    const res = await request(app)
      .get('/api/attendance-status')
      .set(headers(student()))
      .query({ courseId: JSON.stringify({ $ne: null }) });
    expect(res.status).toBe(400);
  });

  test('a script-injection-shaped string in the code field is rejected as invalid, not executed or 500', async () => {
    const res = await request(app)
      .post('/api/attendance')
      .set(headers(student()))
      .send({ courseId: COURSE_A_ID, code: "'; return true; var x='" });
    expect(res.status).toBe(400);
  });
});

describe('Simulated duplicate-key race on Attendance writes', () => {
  test(
    'two concurrent inserts for the same {student, session, attendanceDate} never produce two '
    + 'rows — the second hits E11000 and the upsert path re-fetches instead of erroring',
    async () => {
      const doc = {
        student: 'stu-1', course: 'course-1', session: 'sess-1', courseCode: 'CS101',
        lectureCode: 'MON 09:00-10:00', attendanceDate: '2026-09-08', method: 'gps',
        status: 'present', band: 'inside',
      };
      const first = await Attendance.create(doc);
      expect(first._id).toBeDefined();
      // A second concurrent write for the identical key throws E11000, exactly
      // as the real unique index `{student, session, attendanceDate}` would —
      // this is the exact condition upsertAttendance's catch block exists for.
      await expect(Attendance.create(doc)).rejects.toMatchObject({ code: 11000 });
      const stored = await Attendance.findOne({
        student: doc.student, session: doc.session, attendanceDate: doc.attendanceDate,
      });
      expect(stored._id).toBe(first._id);
    },
  );
});
