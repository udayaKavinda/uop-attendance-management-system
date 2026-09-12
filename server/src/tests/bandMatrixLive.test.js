'use strict';

/**
 * The whole verification contract, end to end, against a real MongoDB.
 *
 * Every other attendance suite mocks the models. That is the right trade for
 * banding arithmetic, but it leaves the parts that are *database* behaviour
 * asserted only against a fake that agrees with itself — and one of those parts
 * was never exercised at all. `unifiedAttendance.routes.test.js` stubs `BleToken`
 * with a store whose `find({ sessionId })` returns **at most one document**, so a
 * session can only ever have a primary row there. Peer seeding's entire reason to
 * exist is a *second* row on the same session, which means the seed branch of
 * `verifyToken` — the one that decides `seedRelayed`, and the one that must refuse
 * to let a seeded student seed again — had no end-to-end coverage on either side.
 *
 * So this suite runs the real Express app over the real models: every band
 * (`inside`/`near`/`suspicious`/`far`/`unknown`), each of the three evidence
 * paths, and the combinations that only appear once BLE and GPS run together in
 * one 90-second window, exactly as both clients do.
 *
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27017/uop_attendance_test npx jest src/tests/bandMatrixLive.test.js
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
const request = require('supertest');

const { liveDbUri, describeLive } = require('./helpers/liveDb');

const URI = liveDbUri('bands');
const describeDb = describeLive(URI, 'bandMatrixLive');

const app = require('../app');
const Person = require('../models/Person');
const Course = require('../models/Course');
const Geofence = require('../models/Geofence');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');
const AttendanceAttempt = require('../models/AttendanceAttempt');
const BleToken = require('../models/BleToken');
const ManualCode = require('../models/ManualCode');
const Settings = require('../models/Settings');

const bluetoothCode = require('../services/bluetoothCode.service');
const manualCode = require('../services/manualCode.service');
const settingsService = require('../services/settings.service');
const sessionService = require('../services/session.service');
const { DAY_INDEX } = require('../utils/schedule');

// ── Geography ────────────────────────────────────────────────────────────────
// A ~60 m square at the UOP Faculty of Engineering. The sample points below are
// not hand-written guesses: each was measured through the server's own
// `distanceToNearestGeofenceMeters` and the comment records what it returned, so
// a change to the geodesy shows up as a band change here rather than silently
// moving what "45 m away" means.
const SQUARE = [
  [80.591528, 7.254029],
  [80.592072, 7.254029],
  [80.592072, 7.254571],
  [80.591528, 7.254571],
];

const AT = (lat, lng, accuracy = 5) => ({ lat, lng, accuracy });

const INSIDE = AT(7.254300, 80.591800); //    0.0 m — within the polygon
const NEAR = AT(7.254978, 80.591800); //     45.3 m — inside the 50 m near buffer
const SUSPICIOUS = AT(7.255250, 80.591800); // 75.4 m — past near, inside the 100 m far buffer
const FAR = AT(7.259093, 80.591800); //      502.8 m — past the far buffer
const VERY_FAR = AT(7.480664, 80.591800); // 25140.4 m — exercises the km-scale reason string

const CSRF = { 'X-Requested-With': 'jest' };
const authHeader = (person) => ({ 'x-test-user': JSON.stringify(person) });
const headers = (person) => ({ ...authHeader(person), ...CSRF });

/** A session window that is open right now, so no clock faking is needed. */
function windowAroundNow(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const start = new Date(now.getTime() - 30 * 60_000);
  const end = new Date(now.getTime() + 30 * 60_000);
  return {
    lectureDay: DAY_INDEX[now.getDay()],
    startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

describeDb('live MongoDB — verification contract end to end', () => {
  let student;
  let other;
  let admin;
  let course;
  let geofence;
  let session;

  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
    await AttendanceAttempt.syncIndexes();
    await BleToken.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      Person.deleteMany({}), Course.deleteMany({}), Geofence.deleteMany({}),
      LectureSession.deleteMany({}), Attendance.deleteMany({}),
      AttendanceAttempt.deleteMany({}), BleToken.deleteMany({}),
      ManualCode.deleteMany({}), Settings.deleteMany({}),
    ]);

    // Reset both read-through caches, or a previous test's session/settings
    // survive into this one for up to five seconds.
    sessionService.invalidateActiveSessionCache();
    await settingsService.updateSettings({
      bleEnabled: true,
      nearBufferM: 50,
      farBufferM: 100,
      nearBufferLogic: 'accuracy_weighted_centroid',
      farBufferLogic: 'accuracy_weighted_centroid',
      seedRate: 0,
      seedWindowMs: 60_000,
    });

    const lecturer = await Person.create({
      email: 'lect@eng.pdn.ac.lk', studentId: 'lect-1', role: 'lecturer', name: 'Lecturer',
    });
    student = await Person.create({
      email: 'e19001@eng.pdn.ac.lk', studentId: 'stu-1', role: 'student', name: 'Student One',
    });
    other = await Person.create({
      email: 'e19002@eng.pdn.ac.lk', studentId: 'stu-2', role: 'student', name: 'Student Two',
    });
    // Only an admin may write settings, and the per-strategy minimum is a settings
    // field, so the band tests below drive it through the real admin route rather
    // than reaching into the document.
    admin = await Person.create({
      email: 'admin@eng.pdn.ac.lk', studentId: 'admin-1', role: 'admin', name: 'Admin',
    });
    course = await Course.create({
      code: 'CS101', name: 'Live Bands', batch: 'E19', lecturers: [lecturer._id], active: true,
    });
    geofence = await Geofence.create({ name: 'Drawing Office', polygon: SQUARE });
    session = await LectureSession.create({
      course: course._id,
      ...windowAroundNow(),
      recurring: true,
      manualCodeRotationMode: 'none',
      manualCodeRotationSeconds: 60,
      buildings: [geofence._id],
      active: true,
    });
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const post = (person, body) =>
    request(app).post('/api/attendance').set(headers(person)).send({ courseId: String(course._id), ...body });

  /** Streams `count` fixes the way a client does, returning the last response. */
  async function streamFixes(person, fix, count = 3) {
    let last;
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await post(person, { fix });
    }
    return last;
  }

  const recordFor = (person) => Attendance.findOne({ student: person._id, session: session._id });
  const attemptFor = (person) =>
    AttendanceAttempt.findOne({ student: String(person._id), session: String(session._id) });

  /** Puts the lecturer on the air so BLE submissions are admitted. */
  async function startBroadcast() {
    await LectureSession.updateOne(
      { _id: session._id },
      { $set: { broadcasting: true, lastBroadcastSeenAt: new Date() } },
    );
    sessionService.invalidateActiveSessionCache();
    session = await LectureSession.findById(session._id);
    return (await bluetoothCode.getToken(String(session._id))).token;
  }

  // ── GPS: every band, through the real HTTP surface ─────────────────────────

  describe('GPS alone', () => {
    test('inside the polygon is an automatic pass, stored with its centroid', async () => {
      const res = await streamFixes(student, INSIDE);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');

      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.method).toBe('gps');
      expect(row.band).toBe('inside');
      expect(row.centroid.fixCount).toBe(3);
      expect(row.centroid.distanceM).toBe(0);
    });

    test('within the near buffer is an automatic pass banded `near`', async () => {
      const res = await streamFixes(student, NEAR);

      expect(res.body.status).toBe('accepted');
      const row = await recordFor(student);
      expect(row.band).toBe('near');
      expect(row.status).toBe('present');
      // Banded on real distance, not on "it passed, call it zero".
      expect(row.centroid.distanceM).toBeGreaterThan(40);
      expect(row.centroid.distanceM).toBeLessThan(50);
    });

    test.each([
      ['suspicious', SUSPICIOUS],
      ['far', FAR],
    ])('%s produces no record and is indistinguishable over the wire', async (band, fix) => {
      const res = await streamFixes(student, fix);

      // The client must not be able to tell these two apart, nor tell either
      // apart from "still gathering fixes".
      expect(res.body).toEqual({ status: 'collecting' });
      expect(await recordFor(student)).toBeNull();

      // ...but the server remembers the band, for a later code submission.
      expect((await attemptFor(student)).band).toBe(band);
    });

    test('a session whose buildings were all deleted fails closed to `unknown`', async () => {
      await Geofence.updateOne({ _id: geofence._id }, { $set: { deleted: true } });

      const res = await post(student, { fix: INSIDE });

      expect(res.body).toEqual({ status: 'collecting' });
      expect(await recordFor(student)).toBeNull();
      const attempt = await attemptFor(student);
      expect(attempt.band).toBe('unknown');
      // The fail-closed verdict is recorded with no fixes behind it at all.
      expect(attempt.fixes).toHaveLength(0);
    });

    test('stays collecting below the three-fix minimum', async () => {
      const res = await streamFixes(student, INSIDE, 2);

      expect(res.body).toEqual({ status: 'collecting' });
      expect(await recordFor(student)).toBeNull();
      expect((await attemptFor(student)).fixes).toHaveLength(2);
    });

    /**
     * The price of removing the outlier trimmer, asserted rather than left to be
     * discovered. Three fixes in the room and one 25 km glitch: under the default
     * accuracy-weighted centroid the glitch now drags the average out of the
     * polygon, so a student who never left the room does not pass on GPS alone.
     *
     * This is the behaviour the trimmer was originally added to prevent, and the
     * mitigation is now an admin choice rather than a hidden pre-filter — the
     * next test shows `median_distance` absorbing the same glitch.
     */
    test('a wild glitch now drags the default centroid, and is not filtered out', async () => {
      await post(student, { fix: INSIDE });
      await post(student, { fix: INSIDE });
      await post(student, { fix: VERY_FAR });
      const res = await post(student, { fix: INSIDE });

      expect(res.body).toEqual({ status: 'collecting' });
      expect(await recordFor(student)).toBeNull();
      const attempt = await attemptFor(student);
      expect(attempt.band).toBe('far');
      expect(attempt.fixes).toHaveLength(4); // nothing was discarded
    });

    test('`median_distance` is the option that absorbs that glitch', async () => {
      await settingsService.updateSettings({
        nearBufferLogic: 'median_distance', farBufferLogic: 'median_distance',
      });

      // Same four submissions as above, in the same order. The pass lands on the
      // third — the one that *is* the glitch — because the median of [0, 0, 25140]
      // is 0, so the extreme reading is present in the sample and simply ignored.
      // Asserting the stored record rather than the last response, since passing
      // clears the attempt and a fourth fix opens an empty one.
      await post(student, { fix: INSIDE });
      await post(student, { fix: INSIDE });
      await post(student, { fix: VERY_FAR });
      await post(student, { fix: INSIDE });

      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.band).toBe('inside');
      expect(row.centroid.distanceM).toBe(0);
    });

    test('attempts are isolated per student', async () => {
      await streamFixes(student, INSIDE, 2);
      await streamFixes(other, FAR, 3);

      // `other`'s three far fixes must not complete `student`'s buffer.
      expect(await recordFor(student)).toBeNull();
      expect((await attemptFor(student)).fixes).toHaveLength(2);
      expect((await attemptFor(other)).band).toBe('far');
    });
  });

  // ── The help code, per band ────────────────────────────────────────────────

  describe('help code escalation', () => {
    const codeFor = async () => (await manualCode.getOrRotateCode(session)).code;

    test('suspicious + correct code → present', async () => {
      await streamFixes(student, SUSPICIOUS);
      expect(await recordFor(student)).toBeNull(); // GPS alone never passes this band

      const res = await post(student, { code: await codeFor() });

      expect(res.body.status).toBe('accepted');
      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.method).toBe('code_override');
      expect(row.band).toBe('suspicious');
      expect(row.reason).toBeNull();
    });

    /**
     * `recordHelpCodeAttendance` also treats `inside` and `near` as passing, but
     * a stored verdict can never actually hold either: `recordGpsFixAttendance`
     * clears both halves of the attempt in the same request that passes, so the
     * only bands that survive to be read here are the three that do not pass on
     * GPS alone. Those two branches are defensive, not live — pinned so that a
     * future change to clear-on-pass is caught by a test rather than by a
     * student, and so the comment above them stays honest.
     */
    test('a pass leaves no verdict behind, so the code path only ever sees the non-passing bands', async () => {
      await streamFixes(student, INSIDE);
      expect((await recordFor(student)).band).toBe('inside');

      expect(await attemptFor(student)).toBeNull();
    });

    test('a code submitted after an automatic pass cannot downgrade it', async () => {
      await streamFixes(student, INSIDE);

      // The verdict is gone, so this reads as `unknown` — which must not turn a
      // present record into a flagged one.
      const res = await post(student, { code: await codeFor() });

      expect(res.body.duplicate).toBe(true);
      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.band).toBe('inside');
      expect(row.method).toBe('gps');
    });

    test('far + correct code → flagged, with the distance in the reason', async () => {
      await streamFixes(student, FAR);

      const res = await post(student, { code: await codeFor() });

      expect(res.body.status).toBe('flagged');
      const row = await recordFor(student);
      expect(row.status).toBe('flagged');
      expect(row.band).toBe('far');
      expect(row.reason).toMatch(/^GPS location is 50[0-9]m from the nearest session building\.$/);
    });

    test('a km-scale distance is reported in km, not as five digits of metres', async () => {
      await streamFixes(student, VERY_FAR);

      await post(student, { code: await codeFor() });

      expect((await recordFor(student)).reason).toBe(
        'GPS location is 25.1km from the nearest session building.',
      );
    });

    test('no fix at all + correct code → flagged `unknown`', async () => {
      const res = await post(student, { code: await codeFor() });

      expect(res.body.status).toBe('flagged');
      const row = await recordFor(student);
      expect(row.band).toBe('unknown');
      expect(row.reason).toBe('Could not verify location.');
    });

    test('a wrong code writes nothing', async () => {
      await streamFixes(student, INSIDE, 2);

      const res = await post(student, { code: '00000000' });

      expect(res.status).toBe(400);
      expect(await recordFor(student)).toBeNull();
    });

    test('the verdict outlives the fixes it was built from', async () => {
      await streamFixes(student, SUSPICIOUS);
      // Age every fix past the 90 s window, exactly as the walk to the front of
      // the hall does, while leaving the verdict alone.
      await AttendanceAttempt.updateOne(
        { student: String(student._id), session: String(session._id) },
        { $set: { fixes: [] } },
      );

      const res = await post(student, { code: await codeFor() });

      expect(res.body.status).toBe('accepted');
      expect((await recordFor(student)).band).toBe('suspicious');
    });
  });

  // ── Bluetooth, including the seed row the mocked suites cannot hold ────────

  describe('Bluetooth', () => {
    test('a live primary token passes outright, without any GPS fix', async () => {
      const token = await startBroadcast();

      const res = await post(student, { token });

      expect(res.body.status).toBe('accepted');
      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.method).toBe('bluetooth');
      expect(row.band).toBe('inside');
      expect(row.seedRelayed).toBe(false);
    });

    test('a token from a peer seeder passes and is marked as relayed', async () => {
      await startBroadcast();
      await settingsService.updateSettings({ seedRate: 3 });
      const claim = await bluetoothCode.claimSeedSlot(
        String(session._id), String(other._id), Date.now() + 60_000, 3,
      );
      expect(claim).not.toBeNull();

      const res = await post(student, { token: claim.token });

      expect(res.body.status).toBe('accepted');
      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.seedRelayed).toBe(true);
    });

    test('a student who heard a seeder seeds in turn, extending the mesh a hop further', async () => {
      await startBroadcast();
      await settingsService.updateSettings({ seedRate: 3 });
      const claim = await bluetoothCode.claimSeedSlot(
        String(session._id), String(other._id), Date.now() + 60_000, 3,
      );

      const res = await post(student, { token: claim.token, canAdvertise: true });

      // Growth hop by hop is the point of seeding in a large hall. The relaying
      // student gets a slot of their own with a distinct token — a second hop,
      // not a re-broadcast of the one they heard.
      expect(res.body.seeding.role).toBe('seed');
      expect(res.body.seeding.token).not.toBe(claim.token);
      expect(await BleToken.countDocuments({ sessionId: String(session._id), role: 'seed' })).toBe(2);
    });

    test('a GPS pass still never seeds, however far the mesh has grown', async () => {
      await settingsService.updateSettings({ seedRate: 3 });

      // The one case the eligibility set still excludes: this student's radio
      // heard nothing, so re-broadcasting from them would put the classroom
      // token somewhere no beacon ever reached.
      const res = await streamFixes(student, NEAR);

      expect(res.body.status).toBe('accepted');
      expect(res.body.seeding).toBeUndefined();
      expect(await BleToken.countDocuments({ role: 'seed' })).toBe(0);
    });

    test('a student who heard the lecturer is offered a real seeder slot', async () => {
      const token = await startBroadcast();
      await settingsService.updateSettings({ seedRate: 3 });

      const res = await post(student, { token, canAdvertise: true });

      expect(res.body.seeding.role).toBe('seed');
      expect(res.body.seeding.token).toMatch(/^[0-9a-f]{16}$/);
      const seedRow = await BleToken.findOne({ sessionId: String(session._id), role: 'seed' });
      expect(String(seedRow.owner)).toBe(String(student._id));
      expect(seedRow.slot).toBe(0);
    });

    test('a device that cannot advertise gets a decoy window of identical length', async () => {
      const token = await startBroadcast();
      await settingsService.updateSettings({ seedRate: 3, seedWindowMs: 45_000 });

      const res = await post(student, { token, canAdvertise: false });

      expect(res.body.seeding).toEqual({ role: 'decoy', durationMs: 45_000 });
      expect(await BleToken.countDocuments({ role: 'seed' })).toBe(0);
    });

    test('the seeder cap holds when a whole lecture is accepted at once', async () => {
      await startBroadcast();
      const seedRate = 3;
      await settingsService.updateSettings({ seedRate });

      const claims = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          bluetoothCode.claimSeedSlot(
            String(session._id), new mongoose.Types.ObjectId().toString(), Date.now() + 60_000, seedRate,
          )),
      );

      // Counting live seeders and then minting was a check-then-act race that
      // measured 5.6x the cap. The slot claim makes over-minting impossible.
      expect(claims.filter(Boolean)).toHaveLength(seedRate);
      expect(await BleToken.countDocuments({ sessionId: String(session._id), role: 'seed' })).toBe(seedRate);
      expect(new Set(claims.filter(Boolean).map((c) => c.slot)).size).toBe(seedRate);
    });

    test('an expired seeder lease stops being accepted', async () => {
      await startBroadcast();
      await settingsService.updateSettings({ seedRate: 3 });
      const claim = await bluetoothCode.claimSeedSlot(
        String(session._id), String(other._id), Date.now() - 1, 3,
      );

      const res = await post(student, { token: claim.token });

      expect(res.status).toBe(400);
      expect(await recordFor(student)).toBeNull();
    });

    test('the previous token stays valid through the rotation grace, then stops', async () => {
      const first = await startBroadcast();
      // Age the row past ROTATION_MS so the next read rotates it.
      await BleToken.updateOne(
        { sessionId: String(session._id), role: 'primary' },
        { $set: { generatedAt: Date.now() - 60_000 } },
      );
      const rotated = (await bluetoothCode.getToken(String(session._id))).token;
      expect(rotated).not.toBe(first);

      // Still inside GRACE_MS: a phone that joined the broadcast is briefly
      // advertising `first`, and a student who hears only that phone must pass.
      expect((await post(student, { token: first })).body.status).toBe('accepted');

      await Attendance.deleteMany({});
      await AttendanceAttempt.deleteMany({});
      // Past the grace, without rotating again.
      await BleToken.updateOne(
        { sessionId: String(session._id), role: 'primary' },
        { $set: { generatedAt: Date.now() - bluetoothCode.GRACE_MS - 1000 } },
      );

      expect((await post(student, { token: first })).status).toBe(400);
      expect((await post(student, { token: rotated })).body.status).toBe('accepted');
    });

    test('the global kill switch refuses Bluetooth but leaves GPS working', async () => {
      const token = await startBroadcast();
      await settingsService.updateSettings({ bleEnabled: false });

      expect((await post(student, { token })).status).toBe(403);
      expect((await streamFixes(student, INSIDE)).body.status).toBe('accepted');
      expect((await recordFor(student)).method).toBe('gps');
    });

    test('a token is refused once the lecturer heartbeat goes stale', async () => {
      const token = await startBroadcast();
      await LectureSession.updateOne(
        { _id: session._id },
        { $set: { lastBroadcastSeenAt: new Date(Date.now() - 120_000) } },
      );
      sessionService.invalidateActiveSessionCache();

      expect((await post(student, { token })).status).toBe(400);
    });
  });

  // ── Both radios in one window, as the clients actually run them ───────────

  describe('GPS and Bluetooth together', () => {
    test('Bluetooth winning mid-stream clears the GPS attempt behind it', async () => {
      const token = await startBroadcast();
      await streamFixes(student, SUSPICIOUS, 2); // GPS still collecting

      const res = await post(student, { token });

      expect(res.body.status).toBe('accepted');
      expect((await recordFor(student)).method).toBe('bluetooth');
      // Both halves of the attempt are torn down together — no orphan buffer.
      expect(await attemptFor(student)).toBeNull();
    });

    test('a GPS pass after a Bluetooth pass is an idempotent no-op', async () => {
      const token = await startBroadcast();
      await post(student, { token });

      const res = await streamFixes(student, INSIDE);

      expect(res.body.duplicate).toBe(true);
      expect(await Attendance.countDocuments({ student: student._id })).toBe(1);
      expect((await recordFor(student)).method).toBe('bluetooth');
    });

    test('a genuine pass upgrades an earlier flagged record in place', async () => {
      await streamFixes(student, FAR);
      await post(student, { code: (await manualCode.getOrRotateCode(session)).code });
      expect((await recordFor(student)).status).toBe('flagged');

      // The student walks into the room and checks in again.
      await AttendanceAttempt.deleteMany({});
      const res = await streamFixes(student, INSIDE);

      expect(res.body.status).toBe('accepted');
      expect(await Attendance.countDocuments({ student: student._id })).toBe(1);
      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.band).toBe('inside');
      expect(row.reason).toBeNull();
    });

    test('seeding is never offered for a GPS pass', async () => {
      await settingsService.updateSettings({ seedRate: 3 });

      const res = await streamFixes(student, INSIDE);

      // A GPS pass only proves the student is within the near buffer of the
      // building — possibly outside the room — so it must not extend the beacon.
      expect(res.body.seeding).toBeUndefined();
      expect(await BleToken.countDocuments({ role: 'seed' })).toBe(0);
    });
  });

  // ── Admin-tunable bands, against the real settings document ───────────────

  describe('admin-configured buffers move the band boundaries', () => {
    test('widening the near buffer turns a suspicious fix into an automatic pass', async () => {
      await settingsService.updateSettings({ nearBufferM: 100 });

      const res = await streamFixes(student, SUSPICIOUS);

      expect(res.body.status).toBe('accepted');
      expect((await recordFor(student)).band).toBe('near');
    });

    test('narrowing the far buffer turns a suspicious fix into a flagged far one', async () => {
      await settingsService.updateSettings({ nearBufferM: 10, farBufferM: 20 });

      await streamFixes(student, SUSPICIOUS);
      await post(student, { code: (await manualCode.getOrRotateCode(session)).code });

      expect((await recordFor(student)).status).toBe('flagged');
      expect((await recordFor(student)).band).toBe('far');
    });

    test('`all_points_within` fails an attempt one stray fix spoiled', async () => {
      await settingsService.updateSettings({
        nearBufferLogic: 'all_points_within', farBufferLogic: 'all_points_within',
      });

      // Deliberately the same four fixes the `any_point_within` test below
      // uses, so the two read as one comparison: identical evidence, opposite
      // verdict, and the difference is only the strategy. A lone stray among
      // three would not reach this code at all — the outlier trimmer drops it
      // and the attempt keeps collecting.
      await post(student, { fix: NEAR });
      await post(student, { fix: SUSPICIOUS });
      await post(student, { fix: NEAR });
      const res = await post(student, { fix: SUSPICIOUS });

      expect(res.body).toEqual({ status: 'collecting' });
      expect(await recordFor(student)).toBeNull();
      // The 75 m pair fails the 50 m near buffer for every fix, which is the
      // "one stray reading fails the whole attempt" cost this strategy warns of.
      expect((await attemptFor(student)).band).toBe('suspicious');
    });

    /**
     * The per-strategy sample requirement, end to end through a real `Settings`
     * document. A Mongoose `Map` is the part a fake cannot vouch for: it is what
     * the merge below writes into, and what `minFixesFor` reads back out.
     */
    test('`any_point_within` decides on two fixes, where the centroid needs three', async () => {
      await settingsService.updateSettings({ nearBufferLogic: 'any_point_within' });

      await post(student, { fix: INSIDE });
      const second = await post(student, { fix: INSIDE });

      expect(second.body.status).toBe('accepted');
      expect((await recordFor(student)).centroid.fixCount).toBe(2);
    });

    test('a raised per-strategy minimum holds the same strategy back', async () => {
      await settingsService.updateSettings({
        nearBufferLogic: 'any_point_within',
        minFixesByStrategy: { any_point_within: 4 },
      });

      await post(student, { fix: INSIDE });
      await post(student, { fix: INSIDE });
      const third = await post(student, { fix: INSIDE });
      expect(third.body).toEqual({ status: 'collecting' });
      expect(await recordFor(student)).toBeNull();

      const fourth = await post(student, { fix: INSIDE });
      expect(fourth.body.status).toBe('accepted');
      expect((await recordFor(student)).centroid.fixCount).toBe(4);
    });

    test('saving one strategy minimum leaves the others alone', async () => {
      // `$set` on a Map replaces the whole map, so the controller merges. Without
      // that, editing one strategy in the dashboard would silently reset every
      // other strategy to its default.
      await request(app).patch('/api/admin/settings').set(headers(admin))
        .send({ minFixesByStrategy: { any_point_within: 5 } })
        .expect(200);

      const res = await request(app).patch('/api/admin/settings').set(headers(admin))
        .send({ minFixesByStrategy: { median_distance: 7 } })
        .expect(200);

      expect(res.body.minFixesByStrategy.any_point_within).toBe(5);
      expect(res.body.minFixesByStrategy.median_distance).toBe(7);
      // Untouched strategies still report their defaults, not null or absent.
      expect(res.body.minFixesByStrategy.accuracy_weighted_centroid).toBe(3);

      const stored = await Settings.findOne({});
      expect(stored.minFixesByStrategy.get('any_point_within')).toBe(5);
      expect(stored.minFixesByStrategy.get('median_distance')).toBe(7);
    });

    test('the settings response carries each strategy its own bounds', async () => {
      const res = await request(app).get('/api/admin/settings').set(headers(admin)).expect(200);

      const byId = Object.fromEntries(res.body.geofenceLogicOptions.map((o) => [o.id, o]));
      expect(byId.any_point_within).toMatchObject({ floorMinFixes: 1, defaultMinFixes: 2 });
      expect(byId.all_points_within).toMatchObject({ floorMinFixes: 3, defaultMinFixes: 3 });
      expect(byId.any_point_within.maxMinFixes).toBeGreaterThan(2);
    });

    test('a minimum below a multi-point strategy floor is refused, not clamped', async () => {
      const res = await request(app).patch('/api/admin/settings').set(headers(admin))
        .send({ minFixesByStrategy: { all_points_within: 1 } })
        .expect(400);

      expect(res.body.error).toContain('All points within geofence');
      const stored = await Settings.findOne({});
      expect(stored.minFixesByStrategy?.get('all_points_within')).toBeUndefined();
    });

    test('`any_point_within` passes on the best fix, not the average', async () => {
      await settingsService.updateSettings({ nearBufferLogic: 'any_point_within' });

      // Two at 45 m and two at 75 m. The centroid sits ~60 m out, which
      // `accuracy_weighted_centroid` would band `suspicious`; `any_point_within`
      // passes on the 45 m pair. Four fixes, spread tightly enough that the
      // outlier trimmer keeps all of them.
      await post(student, { fix: NEAR });
      await post(student, { fix: SUSPICIOUS });
      await post(student, { fix: NEAR });
      const res = await post(student, { fix: SUSPICIOUS });

      expect(res.body.status).toBe('accepted');
      const row = await recordFor(student);
      expect(row.status).toBe('present');
      expect(row.band).toBe('near');
    });
  });

  // ── Window and course guards ─────────────────────────────────────────────

  describe('guards', () => {
    test('a session that is not collecting admits nothing', async () => {
      await LectureSession.updateOne({ _id: session._id }, { $set: { active: false } });
      sessionService.invalidateActiveSessionCache();

      const res = await post(student, { fix: INSIDE });

      expect(res.status).toBe(400);
      expect(await recordFor(student)).toBeNull();
    });

    test('an archived course is refused by name, not by a bare error', async () => {
      await Course.updateOne({ _id: course._id }, { $set: { active: false } });
      sessionService.invalidateActiveSessionCache();

      const res = await post(student, { fix: INSIDE });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('CS101');
    });

    test('a fix outside the schedule window is refused', async () => {
      const pad = (n) => String(n).padStart(2, '0');
      const past = new Date(Date.now() - 3 * 60 * 60_000);
      await LectureSession.updateOne({ _id: session._id }, {
        $set: {
          startTime: `${pad(past.getHours())}:00`,
          endTime: `${pad(past.getHours())}:30`,
        },
      });
      sessionService.invalidateActiveSessionCache();

      const res = await post(student, { fix: INSIDE });

      expect(res.status).toBe(400);
      expect(await recordFor(student)).toBeNull();
    });
  });
});
