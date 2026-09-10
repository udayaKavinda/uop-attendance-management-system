'use strict';

/**
 * The only suite in this repo that talks to a real MongoDB. Every other suite
 * mocks the models, which means schema defaults, validators, `populate`, and
 * unique indexes are all assumed rather than exercised — and those are exactly
 * the pieces that cannot be verified by mocking the thing that implements them.
 *
 * Skipped unless MONGO_TEST_URI is set, so a machine without a database still
 * runs a green suite:
 *
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27017/uop_attendance_test npx jest src/tests/dbIntegration.test.js --runInBand
 *
 * The database named in that URI is DROPPED before and after the run — point it
 * at a scratch name, never at a real one.
 */

const mongoose = require('mongoose');

const URI = process.env.MONGO_TEST_URI || '';

/**
 * This suite calls dropDatabase(), so the database it is pointed at must be a
 * scratch one. Refuses to run against the name the application itself uses
 * (MONGO_URI, defaulting to the documented local `attendance`) rather than
 * quietly destroying a developer's data because two URIs looked similar.
 */
function databaseNameOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(String(uri || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

const TEST_DB = databaseNameOf(URI);
const APP_DB = databaseNameOf(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance');

if (URI && (!TEST_DB || TEST_DB === APP_DB)) {
  throw new Error(
    `[dbIntegration] refusing to run: MONGO_TEST_URI points at "${TEST_DB || '(no database)'}", `
    + `which is the database the application uses. This suite drops the database it connects to — `
    + 'point it at a scratch name such as uop_attendance_test.',
  );
}

const describeDb = URI ? describe : describe.skip;

if (!URI) {
  // eslint-disable-next-line no-console
  console.warn('[dbIntegration] no local MongoDB found and MONGO_TEST_URI not set — skipping live-database suite.');
}

const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Geofence = require('../models/Geofence');
const Person = require('../models/Person');
const Attendance = require('../models/Attendance');

const lectureSessionService = require('../services/lectureSession.service');
const sessionExpiry = require('../services/sessionExpiry.service');
const sessionService = require('../services/session.service');
const { DAY_INDEX } = require('../utils/schedule');
const { localYmd } = require('../utils/date');

/** A clock fixed at local hh:mm today, so schedule windows are deterministic. */
function withClock(hh, mm, fn) {
  const RealDate = Date;
  const base = new RealDate();
  const fixed = new RealDate(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0);
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(fixed);
      return new RealDate(...args);
    }

    static now() { return new RealDate(fixed).getTime(); }
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.Date = RealDate; });
}

describeDb('live MongoDB — courses and sessions', () => {
  let lecturer;
  let building;
  const today = () => DAY_INDEX[new Date().getDay()];
  const admin = () => ({ isAdmin: true, person: { _id: lecturer._id, role: 'admin' } });

  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
    await mongoose.connection.dropDatabase();
    // Indexes are declared on the schemas but only exist once built; the unique
    // ones below are the point of several tests.
    await Promise.all([
      Course.init(), LectureSession.init(), Geofence.init(), Person.init(), Attendance.init(),
    ]);
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      Course.deleteMany({}), LectureSession.deleteMany({}),
      Geofence.deleteMany({}), Person.deleteMany({}), Attendance.deleteMany({}),
    ]);
    sessionService.invalidateActiveSessionCache();
    lecturer = await Person.create({
      email: 'lect@eng.pdn.ac.lk', studentId: 'lect-1', role: 'lecturer', name: 'Lecturer One',
    });
    building = await Geofence.create({
      name: 'Drawing Office 1',
      polygon: [[80.59, 7.25], [80.60, 7.25], [80.60, 7.26], [80.59, 7.26]],
    });
  });

  const makeCourse = (over = {}) => Course.create({
    name: 'Intro', code: 'CS101', batch: 'E23', lecturers: [lecturer._id], ...over,
  });

  const body = (over = {}) => ({
    lectureDay: today(),
    startTime: '08:00',
    endTime: '10:00',
    recurring: true,
    buildings: [String(building._id)],
    manualCodeRotationMode: 'none',
    manualCodeRotationSeconds: 60,
    ...over,
  });

  describe('schema defaults and validators actually apply', () => {
    it('a course defaults to active and a session is persisted inactive', async () => {
      const course = await makeCourse();
      expect(course.active).toBe(true);

      const res = await lectureSessionService.createSession(course, body());
      expect(res.ok).toBe(true);

      // Re-read: this asserts what the DATABASE holds, not what the service returned.
      const stored = await LectureSession.findById(res.session._id);
      expect(stored.active).toBe(false);
      expect(stored.deleted).toBe(false);
      expect(stored.broadcasting).toBe(false);
      expect(stored.occurrenceDate).toBeNull();
    });

    it('rejects a one-time session saved without an occurrenceDate', async () => {
      const course = await makeCourse();
      await expect(LectureSession.create({
        course: course._id,
        lectureDay: today(),
        startTime: '08:00',
        endTime: '10:00',
        recurring: false,
        buildings: [building._id],
        manualCodeRotationMode: 'none',
        manualCodeRotationSeconds: 60,
      })).rejects.toThrow(/occurrenceDate/);
    });

    it('rejects a session with no buildings', async () => {
      const course = await makeCourse();
      await expect(LectureSession.create({
        course: course._id,
        lectureDay: today(),
        startTime: '08:00',
        endTime: '10:00',
        recurring: true,
        buildings: [],
        manualCodeRotationMode: 'none',
        manualCodeRotationSeconds: 60,
      })).rejects.toThrow(/at least one building/i);
    });

    it('enforces the unique (code, batch) index on courses', async () => {
      await makeCourse();
      await expect(makeCourse()).rejects.toThrow(/duplicate key|E11000/i);
    });

    it('allows the same code in a different batch', async () => {
      await makeCourse();
      const other = await makeCourse({ batch: 'E24' });
      expect(other.batch).toBe('E24');
    });
  });

  describe('one-time date resolution against the real clock', () => {
    it('resolves to today when the window is still ahead, and rolls when it is not', async () => {
      const course = await makeCourse();

      const early = await withClock(7, 0, () => lectureSessionService.createSession(
        course, body({ recurring: false, startTime: '12:00', endTime: '13:00' }),
      ));
      expect(early.ok).toBe(true);
      const storedEarly = await LectureSession.findById(early.session._id);
      expect(storedEarly.occurrenceDate).toBe(localYmd());

      await LectureSession.deleteMany({});
      const late = await withClock(23, 0, () => lectureSessionService.createSession(
        course, body({ recurring: false, startTime: '12:00', endTime: '13:00' }),
      ));
      expect(late.ok).toBe(true);
      const storedLate = await LectureSession.findById(late.session._id);
      expect(storedLate.occurrenceDate).not.toBe(localYmd());
      // Exactly one week, never some other interval.
      const days = (new Date(`${storedLate.occurrenceDate}T12:00:00`)
        - new Date(`${localYmd()}T12:00:00`)) / 86400000;
      expect(Math.round(days)).toBe(7);
    });
  });

  describe('overlap detection queries the real collection', () => {
    it('rejects a clashing session and names the existing one', async () => {
      const course = await makeCourse();
      expect((await lectureSessionService.createSession(course, body())).ok).toBe(true);

      const clash = await lectureSessionService.createSession(
        course, body({ startTime: '09:00', endTime: '11:00' }),
      );
      expect(clash.ok).toBe(false);
      expect(clash.error).toContain('08:00-10:00');
      expect(await LectureSession.countDocuments({})).toBe(1);
    });

    it('allows a non-overlapping slot on the same day', async () => {
      const course = await makeCourse();
      await lectureSessionService.createSession(course, body());
      const ok = await lectureSessionService.createSession(
        course, body({ startTime: '10:00', endTime: '12:00' }),
      );
      expect(ok.ok).toBe(true);
      expect(await LectureSession.countDocuments({})).toBe(2);
    });

    it('ignores a spent one-time session when checking for a clash', async () => {
      const course = await makeCourse();
      await LectureSession.create({
        course: course._id,
        lectureDay: today(),
        startTime: '08:00',
        endTime: '10:00',
        recurring: false,
        occurrenceDate: '2020-01-01',
        buildings: [building._id],
        manualCodeRotationMode: 'none',
        manualCodeRotationSeconds: 60,
      });
      const ok = await lectureSessionService.createSession(course, body());
      expect(ok.ok).toBe(true);
    });
  });

  describe('the staff list, with real populate', () => {
    async function seed() {
      const course = await makeCourse();
      const weekly = await lectureSessionService.createSession(course, body());
      const spent = await LectureSession.create({
        course: course._id,
        lectureDay: today(),
        startTime: '12:00',
        endTime: '13:00',
        recurring: false,
        occurrenceDate: '2020-01-01',
        buildings: [building._id],
        manualCodeRotationMode: 'none',
        manualCodeRotationSeconds: 60,
      });
      return { course, weekly: weekly.session, spent };
    }

    it('hides a spent one-time session but keeps the weekly one', async () => {
      const { weekly, spent } = await seed();
      const listed = await withClock(9, 0, () => lectureSessionService.listAllForStaff(admin(), null));
      const ids = listed.map((s) => String(s._id));
      expect(ids).toContain(String(weekly._id));
      expect(ids).not.toContain(String(spent._id));
      // Hidden, not deleted — the row is still there to label its own history.
      expect(await LectureSession.countDocuments({})).toBe(2);
    });

    it('hides every session of an archived course, and restores them on unarchive', async () => {
      const { course } = await seed();
      course.active = false;
      await course.save();
      expect(await withClock(9, 0, () => lectureSessionService.listAllForStaff(admin(), null)))
        .toHaveLength(0);

      course.active = true;
      await course.save();
      expect((await withClock(9, 0, () => lectureSessionService.listAllForStaff(admin(), null))).length)
        .toBeGreaterThan(0);
    });

    it('scopes a lecturer to their own courses only', async () => {
      const mine = await makeCourse();
      const otherLecturer = await Person.create({
        email: 'other@eng.pdn.ac.lk', studentId: 'lect-2', role: 'lecturer', name: 'Other',
      });
      const theirs = await Course.create({
        name: 'Other', code: 'CS999', batch: 'E23', lecturers: [otherLecturer._id],
      });
      await lectureSessionService.createSession(mine, body());
      await lectureSessionService.createSession(theirs, body({ startTime: '14:00', endTime: '15:00' }));

      const listed = await withClock(9, 0, () => lectureSessionService.listAllForStaff(
        { isAdmin: false, person: lecturer }, null,
      ));
      expect(listed).toHaveLength(1);
      expect(String(listed[0].course._id)).toBe(String(mine._id));
    });

    it('reports pagination totals over the visible set, not the stored set', async () => {
      await seed();
      const paged = await withClock(9, 0, () => lectureSessionService.listAllForStaff(
        admin(), { hasLimit: true, page: 1, limit: 10 },
      ));
      expect(paged.total).toBe(1);
      expect(await LectureSession.countDocuments({})).toBe(2);
    });
  });

  describe('Collect and the expiry sweep against stored documents', () => {
    it('refuses Collect outside the window and leaves the stored flag alone', async () => {
      const course = await makeCourse();
      const { session } = await lectureSessionService.createSession(course, body());
      const res = await withClock(6, 0, () => lectureSessionService.activateSession(session));
      expect(res.ok).toBe(false);
      expect((await LectureSession.findById(session._id)).active).toBe(false);
    });

    it('persists active=true on a Collect inside the window', async () => {
      const course = await makeCourse();
      const { session } = await lectureSessionService.createSession(course, body());
      const res = await withClock(9, 0, () => lectureSessionService.activateSession(session));
      expect(res.ok).toBe(true);
      expect((await LectureSession.findById(session._id)).active).toBe(true);
    });

    it('the sweep deactivates a spent one-time session and spares a live weekly one', async () => {
      const course = await makeCourse();
      const { session: weekly } = await lectureSessionService.createSession(course, body());
      await withClock(9, 0, () => lectureSessionService.activateSession(weekly));

      const spent = await LectureSession.create({
        course: course._id,
        lectureDay: today(),
        startTime: '12:00',
        endTime: '13:00',
        recurring: false,
        occurrenceDate: '2020-01-01',
        active: true,
        buildings: [building._id],
        manualCodeRotationMode: 'none',
        manualCodeRotationSeconds: 60,
      });

      await sessionExpiry.deactivateExpiredNonRecurringSessions();
      expect((await LectureSession.findById(spent._id)).active).toBe(false);
      expect((await LectureSession.findById(weekly._id)).active).toBe(true);
    });

    it('the weekly sweep resets active once the window has closed', async () => {
      const course = await makeCourse();
      const { session } = await lectureSessionService.createSession(course, body());
      await withClock(9, 0, () => lectureSessionService.activateSession(session));
      await withClock(23, 0, () => sessionExpiry.deactivateRecurringSessionsPastWindow());
      expect((await LectureSession.findById(session._id)).active).toBe(false);
    });

    it('a soft-deleted session leaves the row but vanishes from the list', async () => {
      const course = await makeCourse();
      const { session } = await lectureSessionService.createSession(course, body());
      await lectureSessionService.softDeleteSession(session);

      const stored = await LectureSession.findById(session._id);
      expect(stored).not.toBeNull();
      expect(stored.deleted).toBe(true);
      expect(await withClock(9, 0, () => lectureSessionService.listAllForStaff(admin(), null)))
        .toHaveLength(0);
    });
  });

  describe('student-facing resolution', () => {
    it('admits a course whose session is collecting, and refuses once it is not', async () => {
      const course = await makeCourse();
      const { session } = await lectureSessionService.createSession(course, body());
      await withClock(9, 0, () => lectureSessionService.activateSession(session));

      sessionService.invalidateActiveSessionCache();
      const inWindow = await withClock(9, 0, () => sessionService.resolveActiveSessionForCourse(course._id));
      expect(inWindow.error).toBeUndefined();
      expect(String(inWindow.session._id)).toBe(String(session._id));

      sessionService.invalidateActiveSessionCache();
      const outOfWindow = await withClock(23, 0, () => sessionService.resolveActiveSessionForCourse(course._id));
      expect(outOfWindow.error).toMatch(/no active lecture session/i);
    });

    it('names an archived course rather than blaming the request', async () => {
      const course = await makeCourse();
      course.active = false;
      await course.save();
      sessionService.invalidateActiveSessionCache();
      const res = await sessionService.resolveActiveSessionForCourse(course._id);
      expect(res.error).toMatch(/CS101/);
      expect(res.error).toMatch(/archived/i);
    });
  });

  describe('the attendance uniqueness index is real', () => {
    it('refuses a second record for the same student, session and date', async () => {
      const course = await makeCourse();
      const { session } = await lectureSessionService.createSession(course, body());
      const student = await Person.create({
        email: 'e19999@eng.pdn.ac.lk', studentId: 'stu-1', role: 'student',
      });
      const row = {
        student: student._id,
        course: course._id,
        session: session._id,
        courseCode: 'CS101',
        lectureCode: 'CS101',
        attendanceDate: localYmd(),
        status: 'present',
        method: 'gps',
      };
      await Attendance.create(row);
      await expect(Attendance.create(row)).rejects.toThrow(/duplicate key|E11000/i);
      // A different day is a different occurrence, so it must be allowed.
      await Attendance.create({ ...row, attendanceDate: '2020-01-01' });
      expect(await Attendance.countDocuments({})).toBe(2);
    });
  });
});
