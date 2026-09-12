'use strict';

/**
 * The database is allowed to be exactly one shape: the one the current models
 * describe. There is no migration path and no tolerance for an older one, so the
 * two mechanisms that enforce that are worth pinning against a real MongoDB —
 * neither can be verified by mocking the thing that implements it.
 *
 *   1. `assertNoRetiredCollections` refuses to serve a database that still holds
 *      collections from a previous schema.
 *   2. `syncAllIndexes` DROPS indexes the schema no longer declares. `autoIndex`
 *      only ever creates, so without this a retired index is maintained on every
 *      write forever — and a retired *unique* index keeps rejecting writes the
 *      code considers perfectly legal.
 */

const mongoose = require('mongoose');

const { liveDbUri, describeLive } = require('./helpers/liveDb');

const URI = liveDbUri('drift');
const describeDb = describeLive(URI, 'schemaDrift');

const {
  assertNoRetiredCollections, syncAllIndexes, RETIRED_COLLECTIONS,
} = require('../config/database');

const Attendance = require('../models/Attendance');
const Course = require('../models/Course');
const AuditLog = require('../models/AuditLog');
const BleToken = require('../models/BleToken');
const Geofence = require('../models/Geofence');
const LectureSession = require('../models/LectureSession');

const indexNamesOf = async (model) => (await model.collection.indexes()).map((i) => i.name).sort();

describeDb('live MongoDB — schema drift is refused, not migrated', () => {
  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe('retired collections', () => {
    afterEach(async () => {
      for (const name of RETIRED_COLLECTIONS) {
        // eslint-disable-next-line no-await-in-loop
        await mongoose.connection.db.collection(name).drop().catch(() => {});
      }
    });

    it('passes on a database that only holds current collections', async () => {
      await expect(assertNoRetiredCollections()).resolves.toEqual([]);
    });

    it('names the pre-merge collections when they are still present', async () => {
      await mongoose.connection.db.createCollection('gpsfixbuffers');
      await mongoose.connection.db.createCollection('attemptverdicts');
      const found = await assertNoRetiredCollections();
      expect(found.sort()).toEqual(['attemptverdicts', 'gpsfixbuffers']);
    });

    it('reports only the ones actually there, not the whole list', async () => {
      await mongoose.connection.db.createCollection('gpsfixbuffers');
      await expect(assertNoRetiredCollections()).resolves.toEqual(['gpsfixbuffers']);
    });

    // The two halves of one attempt live in `attendanceattempts` now. A database
    // holding the old pair is not half-migrated, it is a different schema.
    it('does not treat the current attempt collection as retired', async () => {
      await mongoose.connection.db.createCollection('attendanceattempts');
      await expect(assertNoRetiredCollections()).resolves.toEqual([]);
      await mongoose.connection.db.collection('attendanceattempts').drop().catch(() => {});
    });
  });

  describe('index sync', () => {
    it('drops an index the schema no longer declares', async () => {
      await Attendance.createCollection();
      await Attendance.collection.createIndex({ attendanceDate: 1 }, { name: 'attendanceDate_1' });
      expect(await indexNamesOf(Attendance)).toContain('attendanceDate_1');

      await syncAllIndexes();

      expect(await indexNamesOf(Attendance)).not.toContain('attendanceDate_1');
    });

    // The dangerous case: a unique index left behind from an older schema does
    // not merely cost writes, it rejects ones the code considers legal.
    it('drops a retired UNIQUE index, so legal writes stop being rejected', async () => {
      await Attendance.createCollection();
      await Attendance.collection.createIndex(
        { session: 1 }, { name: 'session_1_legacy_unique', unique: true },
      );
      await syncAllIndexes();
      expect(await indexNamesOf(Attendance)).not.toContain('session_1_legacy_unique');
    });

    it('creates the indexes the schema does declare', async () => {
      await syncAllIndexes();
      const names = await indexNamesOf(Attendance);
      expect(names).toContain('student_1_session_1_attendanceDate_1');
      expect(names).toContain('session_1_attendanceDate_1');
    });

    it('is idempotent — a second run changes nothing', async () => {
      await syncAllIndexes();
      const before = await indexNamesOf(Attendance);
      await syncAllIndexes();
      expect(await indexNamesOf(Attendance)).toEqual(before);
    });
  });

  /**
   * These assertions exist to stop a redundant index creeping back. Every one
   * removed here was a strict PREFIX of a compound index that already served the
   * same queries, so it earned nothing and was still rebuilt on every write.
   */
  describe('no index earns its cost twice', () => {
    beforeAll(async () => {
      await syncAllIndexes();
    });

    it('Course has no standalone { code: 1 } beside the unique { code, batch }', async () => {
      const names = await indexNamesOf(Course);
      expect(names).toContain('code_1_batch_1');
      expect(names).not.toContain('code_1');
    });

    it('LectureSession has no standalone { course: 1 }', async () => {
      const names = await indexNamesOf(LectureSession);
      expect(names).toContain('course_1_lectureDay_1_startTime_1_endTime_1');
      expect(names).not.toContain('course_1');
    });

    it('BleToken has no standalone { sessionId: 1 }', async () => {
      const names = await indexNamesOf(BleToken);
      expect(names).toContain('sessionId_1_owner_1_role_1');
      expect(names).not.toContain('sessionId_1');
    });

    // A single-field index is traversable in both directions, so the ascending
    // TTL index already serves the newest-first reads.
    it('AuditLog keeps one index on `at`, not one per direction', async () => {
      const names = await indexNamesOf(AuditLog);
      expect(names).toContain('at_1');
      expect(names).not.toContain('at_-1');
    });

    it('Geofence indexes neither boolean flag', async () => {
      const names = await indexNamesOf(Geofence);
      expect(names).not.toContain('active_1');
      expect(names).not.toContain('deleted_1');
      expect(names).toEqual(['_id_']);
    });
  });

  describe('the models write what the current code reads', () => {
    it('Attendance carries createdAt/updatedAt and no hand-rolled timestamp', () => {
      const paths = Object.keys(Attendance.schema.paths);
      expect(paths).toContain('createdAt');
      expect(paths).toContain('updatedAt');
      expect(paths).not.toContain('timestamp');
    });

    // `centroid` is a single-nested subdocument, so its fields live on the
    // nested schema rather than as dotted paths on the parent.
    it('an attempt centroid stores only what is read back from it', () => {
      const centroid = mongoose.model('AttendanceAttempt').schema.path('centroid');
      expect(Object.keys(centroid.schema.paths).sort())
        .toEqual(['fixCount', 'lat', 'lng']);
    });
  });
});
