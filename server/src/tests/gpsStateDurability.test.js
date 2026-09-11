'use strict';

/**
 * Live-MongoDB tests for the two collections that carry an attendance attempt.
 *
 * These exist because the properties that matter here are properties of the
 * database, not of our code: that a `$push` from two requests at once keeps
 * both fixes, that one (student, session) can only ever have one buffer, that a
 * verdict written by one process is readable by another, and that nothing is
 * cached in a module's closure. A fake cannot demonstrate any of that — it can
 * only demonstrate that the fake agrees with itself.
 *
 * The headline case is `survives a restart between the GPS attempt and the code
 * submission`. That is the production incident this state moved out of memory
 * for: a student measured inside the building, a deploy in the gap, and a
 * `flagged` record for someone who was standing in the room.
 *
 * Skipped unless MONGO_TEST_URI is set:
 *
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27017/uop_attendance_test npx jest src/tests/gpsStateDurability.test.js --runInBand
 */

const mongoose = require('mongoose');

const URI = process.env.MONGO_TEST_URI || '';

function databaseNameOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(String(uri || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

const TEST_DB = databaseNameOf(URI);
const APP_DB = databaseNameOf(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance');

if (URI && (!TEST_DB || TEST_DB === APP_DB)) {
  throw new Error(
    `[gpsStateDurability] refusing to run: MONGO_TEST_URI points at "${TEST_DB || '(no database)'}", `
    + 'which is the database the application uses.',
  );
}

const describeDb = URI ? describe : describe.skip;

if (!URI) {
  // eslint-disable-next-line no-console
  console.warn('[gpsStateDurability] no MONGO_TEST_URI — skipping live-database suite.');
}

const GpsFixBuffer = require('../models/GpsFixBuffer');
const AttemptVerdict = require('../models/AttemptVerdict');

let gpsFix = require('../services/gpsFix.service');
let attemptVerdict = require('../services/attemptVerdict.service');

const SQUARE = [[80.5913, 7.2542], [80.5923, 7.2542], [80.5923, 7.2552], [80.5913, 7.2552]];
const GEOFENCES = [{ polygon: SQUARE }];
const BUFFERS = {
  nearBufferM: 50,
  farBufferM: 100,
  nearBufferLogic: 'accuracy_weighted_centroid',
  farBufferLogic: 'accuracy_weighted_centroid',
};
const INSIDE = { lat: 7.2547, lng: 80.5918, accuracy: 8 };
const FAR = { lat: 7.2750, lng: 80.5918, accuracy: 8 };

/**
 * Re-executes the service modules, which is what a deploy does to them. Any
 * state that survives this came from MongoDB; anything that does not survive it
 * was a closure variable, which is exactly the failure being guarded against.
 *
 * Only the services are evicted, deliberately. `jest.resetModules()` would also
 * reset mongoose, and the re-required services would then bind to a fresh,
 * unconnected mongoose singleton whose queries buffer forever — every test
 * hanging on a connection that was never reopened, which looks like a product
 * failure and is entirely an artefact of the test.
 */
const SERVICE_PATHS = ['../services/gpsFix.service', '../services/attemptVerdict.service'];

function restartProcess() {
  SERVICE_PATHS.forEach((p) => { delete require.cache[require.resolve(p)]; });
  // eslint-disable-next-line global-require
  gpsFix = require('../services/gpsFix.service');
  // eslint-disable-next-line global-require
  attemptVerdict = require('../services/attemptVerdict.service');
}

describeDb('live MongoDB — durable attempt state', () => {
  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
    await Promise.all([GpsFixBuffer.init(), AttemptVerdict.init()]);
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        GpsFixBuffer.deleteMany({}),
        AttemptVerdict.deleteMany({}),
      ]);
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    restartProcess();
    await Promise.all([GpsFixBuffer.deleteMany({}), AttemptVerdict.deleteMany({})]);
  });

  // ── the incident ─────────────────────────────────────────────────────────

  describe('the incident this state moved out of memory for', () => {
    it('survives a restart between the GPS attempt and the code submission', async () => {
      const student = 'stu-restart';
      const session = 'sess-restart';

      let verdict;
      for (let i = 0; i < 3; i += 1) {
        verdict = await gpsFix.evaluateFix(student, session, INSIDE, GEOFENCES, BUFFERS);
      }
      expect(verdict.ready).toBe(true);
      expect(verdict.band).toBe('inside');
      await attemptVerdict.record(student, session, {
        band: verdict.band, centroid: verdict.centroid, distanceM: verdict.distanceM,
      });

      // The deploy happens here.
      restartProcess();

      const stored = await attemptVerdict.get(student, session);
      expect(stored).not.toBeNull();
      expect(stored.band).toBe('inside');
      // Which is what turns the later code submission into `present`, not `flagged`.
      expect(['inside', 'near', 'suspicious']).toContain(stored.band);
    });

    it('a fix buffer mid-attempt also survives a restart', async () => {
      const student = 'stu-midwindow';
      const session = 'sess-midwindow';

      await gpsFix.addFix(student, session, INSIDE);
      await gpsFix.addFix(student, session, INSIDE);
      expect(await gpsFix.computeCentroid(student, session)).toBeNull(); // 2 < MIN_FIXES

      restartProcess();

      // The third fix lands on the same buffer the previous process started.
      const verdict = await gpsFix.evaluateFix(student, session, INSIDE, GEOFENCES, BUFFERS);
      expect(verdict.ready).toBe(true);
      expect(verdict.centroid.fixCount).toBe(3);
    });
  });

  // ── multi-instance ───────────────────────────────────────────────────────

  describe('more than one app instance', () => {
    it('a verdict recorded by one instance is readable by another', async () => {
      const student = 'stu-two-instances';
      const session = 'sess-two-instances';

      await attemptVerdict.record(student, session, { band: 'near', distanceM: 21 });

      restartProcess();
      const otherInstance = attemptVerdict;
      const seen = await otherInstance.get(student, session);

      expect(seen).not.toBeNull();
      expect(seen.band).toBe('near');
      expect(seen.distanceM).toBe(21);
    });

    it('fixes from two instances accumulate into one buffer and reach a verdict', async () => {
      const student = 'stu-split';
      const session = 'sess-split';

      await gpsFix.addFix(student, session, INSIDE);
      restartProcess();
      const instanceB = gpsFix;
      await instanceB.addFix(student, session, INSIDE);
      const verdict = await instanceB.evaluateFix(student, session, INSIDE, GEOFENCES, BUFFERS);

      expect(verdict.ready).toBe(true);
      expect(verdict.centroid.fixCount).toBe(3);
      expect(await GpsFixBuffer.countDocuments({ student, session })).toBe(1);
    });
  });

  // ── concurrency ──────────────────────────────────────────────────────────

  describe('concurrent writes', () => {
    it('keeps every fix when many arrive at once', async () => {
      const student = 'stu-concurrent';
      const session = 'sess-concurrent';
      const N = 25;

      await Promise.all(
        Array.from({ length: N }, () => gpsFix.addFix(student, session, INSIDE)),
      );

      const doc = await GpsFixBuffer.findOne({ student, session });
      expect(doc.fixes).toHaveLength(N);
      expect(await GpsFixBuffer.countDocuments({ student, session })).toBe(1);
    });

    it('concurrent upserts still produce exactly one buffer document', async () => {
      const student = 'stu-upsert-race';
      const session = 'sess-upsert-race';

      // All of these race to create the same document.
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => gpsFix.addFix(student, session, INSIDE)),
      );
      const rejected = results.filter((r) => r.status === 'rejected');

      // A duplicate-key rejection here would mean a lost fix in production.
      expect(rejected).toHaveLength(0);
      expect(await GpsFixBuffer.countDocuments({ student, session })).toBe(1);
    });

    it('concurrent verdict writes leave exactly one verdict', async () => {
      const student = 'stu-verdict-race';
      const session = 'sess-verdict-race';

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => attemptVerdict.record(student, session, {
          band: i % 2 ? 'near' : 'inside',
        })),
      );
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
      expect(await AttemptVerdict.countDocuments({ student, session })).toBe(1);
    });
  });

  // ── isolation ────────────────────────────────────────────────────────────

  describe('isolation between attempts', () => {
    it('two students in the same session keep separate buffers', async () => {
      await gpsFix.addFix('stu-a', 'sess-shared', INSIDE);
      await gpsFix.addFix('stu-a', 'sess-shared', INSIDE);
      await gpsFix.addFix('stu-a', 'sess-shared', INSIDE);
      await gpsFix.addFix('stu-b', 'sess-shared', FAR);

      expect((await gpsFix.computeCentroid('stu-a', 'sess-shared')).fixCount).toBe(3);
      expect(await gpsFix.computeCentroid('stu-b', 'sess-shared')).toBeNull();
    });

    it('one student in two sessions keeps separate buffers', async () => {
      await gpsFix.addFix('stu-multi', 'sess-1', INSIDE);
      await gpsFix.addFix('stu-multi', 'sess-1', INSIDE);
      await gpsFix.addFix('stu-multi', 'sess-1', INSIDE);
      await gpsFix.addFix('stu-multi', 'sess-2', INSIDE);

      expect((await gpsFix.computeCentroid('stu-multi', 'sess-1')).fixCount).toBe(3);
      expect(await gpsFix.computeCentroid('stu-multi', 'sess-2')).toBeNull();
    });

    it('clearing one attempt leaves the other intact', async () => {
      for (let i = 0; i < 3; i += 1) await gpsFix.addFix('stu-keep', 'sess-x', INSIDE);
      for (let i = 0; i < 3; i += 1) await gpsFix.addFix('stu-clear', 'sess-x', INSIDE);

      await gpsFix.clearFixes('stu-clear', 'sess-x');

      expect(await gpsFix.computeCentroid('stu-clear', 'sess-x')).toBeNull();
      expect(await gpsFix.computeCentroid('stu-keep', 'sess-x')).not.toBeNull();
    });
  });

  // ── the window and the cap ───────────────────────────────────────────────

  describe('window and bounds', () => {
    it('ignores fixes older than the window when banding', async () => {
      const student = 'stu-stale';
      const session = 'sess-stale';
      const old = Date.now() - gpsFix.FIX_WINDOW_MS - 5_000;

      await GpsFixBuffer.create({
        student,
        session,
        fixes: [
          { ...INSIDE, ts: old }, { ...INSIDE, ts: old }, { ...INSIDE, ts: old },
        ],
      });

      // Three fixes are stored, but none of them are live.
      expect((await GpsFixBuffer.findOne({ student, session })).fixes).toHaveLength(3);
      expect(await gpsFix.computeCentroid(student, session)).toBeNull();
    });

    it('a fresh fix does not resurrect stale ones', async () => {
      const student = 'stu-mixed';
      const session = 'sess-mixed';
      const old = Date.now() - gpsFix.FIX_WINDOW_MS - 5_000;
      await GpsFixBuffer.create({
        student, session, fixes: [{ ...INSIDE, ts: old }, { ...INSIDE, ts: old }],
      });

      const live = await gpsFix.addFix(student, session, INSIDE);

      expect(live).toHaveLength(1); // only the new one is inside the window
      expect(await gpsFix.computeCentroid(student, session)).toBeNull();
    });

    it('caps the stored array so one client cannot grow a document without bound', async () => {
      const student = 'stu-flood';
      const session = 'sess-flood';
      const over = gpsFix.MAX_BUFFERED_FIXES + 40;

      for (let i = 0; i < over; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await gpsFix.addFix(student, session, INSIDE);
      }

      const doc = await GpsFixBuffer.findOne({ student, session });
      expect(doc.fixes.length).toBe(gpsFix.MAX_BUFFERED_FIXES);
    }, 120000);
  });

  // ── sweep, against the real query ────────────────────────────────────────

  describe('sweep', () => {
    it('deletes buffers with no live fix and keeps the ones that have one', async () => {
      const old = Date.now() - gpsFix.FIX_WINDOW_MS - 5_000;
      await GpsFixBuffer.create({ student: 'dead', session: 's', fixes: [{ ...INSIDE, ts: old }] });
      await GpsFixBuffer.create({ student: 'alive', session: 's', fixes: [{ ...INSIDE, ts: Date.now() }] });

      const removed = await gpsFix.sweep();

      expect(removed).toBe(1);
      expect(await GpsFixBuffer.countDocuments({ student: 'dead' })).toBe(0);
      expect(await GpsFixBuffer.countDocuments({ student: 'alive' })).toBe(1);
    });

    it('deletes a buffer that has no fixes at all', async () => {
      await GpsFixBuffer.create({ student: 'empty', session: 's', fixes: [] });
      await gpsFix.sweep();
      expect(await GpsFixBuffer.countDocuments({ student: 'empty' })).toBe(0);
    });

    it('keeps a buffer where only one of several fixes is still live', async () => {
      const old = Date.now() - gpsFix.FIX_WINDOW_MS - 5_000;
      await GpsFixBuffer.create({
        student: 'partly', session: 's',
        fixes: [{ ...INSIDE, ts: old }, { ...INSIDE, ts: old }, { ...INSIDE, ts: Date.now() }],
      });
      await gpsFix.sweep();
      expect(await GpsFixBuffer.countDocuments({ student: 'partly' })).toBe(1);
    });
  });

  // ── verdict semantics ────────────────────────────────────────────────────

  describe('attempt verdicts', () => {
    it('returns null for an attempt that never recorded one', async () => {
      expect(await attemptVerdict.get('nobody', 'nowhere')).toBeNull();
    });

    it('keeps the newest verdict, not the first', async () => {
      await attemptVerdict.record('stu-newest', 'sess', { band: 'far', distanceM: 900 });
      await attemptVerdict.record('stu-newest', 'sess', { band: 'inside', distanceM: 0 });

      const got = await attemptVerdict.get('stu-newest', 'sess');
      expect(got.band).toBe('inside');
      expect(got.distanceM).toBe(0);
      expect(await AttemptVerdict.countDocuments({ student: 'stu-newest' })).toBe(1);
    });

    it('expires on age rather than waiting for the TTL monitor, and deletes the row', async () => {
      const student = 'stu-expired';
      const session = 'sess-expired';
      await attemptVerdict.record(student, session, { band: 'inside' });

      // Read from a moment past the TTL instead of faking the clock.
      const later = Date.now() + attemptVerdict.VERDICT_TTL_MS + 1;
      expect(await attemptVerdict.get(student, session, later)).toBeNull();
      expect(await AttemptVerdict.countDocuments({ student, session })).toBe(0);
    });

    it('is still valid one tick before the TTL', async () => {
      await attemptVerdict.record('stu-fresh', 'sess', { band: 'near' });
      const justBefore = Date.now() + attemptVerdict.VERDICT_TTL_MS - 1_000;
      expect(await attemptVerdict.get('stu-fresh', 'sess', justBefore)).not.toBeNull();
    });

    it('round-trips the centroid a code submission is judged against', async () => {
      await attemptVerdict.record('stu-centroid', 'sess', {
        band: 'suspicious',
        centroid: { lat: 7.2547, lng: 80.5918, bestAccuracy: 8, fixCount: 5 },
        distanceM: 78.5,
      });

      const got = await attemptVerdict.get('stu-centroid', 'sess');
      expect(got.band).toBe('suspicious');
      expect(got.centroid.lat).toBeCloseTo(7.2547, 6);
      expect(got.centroid.fixCount).toBe(5);
      expect(got.distanceM).toBeCloseTo(78.5, 3);
    });

    it('records an unknown band with no centroid', async () => {
      await attemptVerdict.record('stu-unknown', 'sess', { band: 'unknown' });
      const got = await attemptVerdict.get('stu-unknown', 'sess');
      expect(got.band).toBe('unknown');
      expect(got.centroid).toBeNull();
    });

    it('clear removes it', async () => {
      await attemptVerdict.record('stu-cleared', 'sess', { band: 'inside' });
      await attemptVerdict.clear('stu-cleared', 'sess');
      expect(await attemptVerdict.get('stu-cleared', 'sess')).toBeNull();
    });

    it('sweep removes aged verdicts and leaves fresh ones', async () => {
      await AttemptVerdict.create({
        student: 'old', session: 's', band: 'inside', ts: Date.now() - attemptVerdict.VERDICT_TTL_MS - 1,
      });
      await AttemptVerdict.create({
        student: 'new', session: 's', band: 'inside', ts: Date.now(),
      });

      const removed = await attemptVerdict.sweep();

      expect(removed).toBe(1);
      expect(await AttemptVerdict.countDocuments({ student: 'old' })).toBe(0);
      expect(await AttemptVerdict.countDocuments({ student: 'new' })).toBe(1);
    });
  });

  // ── schema guarantees ────────────────────────────────────────────────────

  describe('collection guarantees', () => {
    it('enforces one buffer per (student, session)', async () => {
      await GpsFixBuffer.create({ student: 'dup', session: 's', fixes: [] });
      await expect(GpsFixBuffer.create({ student: 'dup', session: 's', fixes: [] }))
        .rejects.toThrow(/duplicate key/i);
    });

    it('enforces one verdict per (student, session)', async () => {
      await AttemptVerdict.create({ student: 'dup', session: 's', band: 'inside', ts: Date.now() });
      await expect(AttemptVerdict.create({ student: 'dup', session: 's', band: 'near', ts: Date.now() }))
        .rejects.toThrow(/duplicate key/i);
    });

    it('rejects a band the banding code cannot produce', async () => {
      await expect(AttemptVerdict.create({ student: 'bad', session: 's', band: 'elsewhere', ts: Date.now() }))
        .rejects.toThrow(/validation/i);
    });

    it('carries a TTL index on both collections so abandoned state cannot accumulate', async () => {
      const fixIdx = await GpsFixBuffer.collection.indexes();
      const verdictIdx = await AttemptVerdict.collection.indexes();

      expect(fixIdx.some((i) => i.expireAfterSeconds !== undefined)).toBe(true);
      expect(verdictIdx.some((i) => i.expireAfterSeconds !== undefined)).toBe(true);

      // And the TTL must outlast the window it is cleaning up after, or it would
      // race the attempt it belongs to.
      const fixTtl = fixIdx.find((i) => i.expireAfterSeconds !== undefined).expireAfterSeconds;
      expect(fixTtl * 1000).toBeGreaterThan(gpsFix.FIX_WINDOW_MS);
      const verdictTtl = verdictIdx.find((i) => i.expireAfterSeconds !== undefined).expireAfterSeconds;
      expect(verdictTtl * 1000).toBeGreaterThanOrEqual(attemptVerdict.VERDICT_TTL_MS);
    });
  });
});
