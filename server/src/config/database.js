const mongoose = require('mongoose');
const { mongoUri, isProd } = require('./env');

/**
 * Every model, in one place, so index sync and the schema guard below cannot
 * silently miss one. A model added without being listed here would keep its
 * indexes only by luck — `autoIndex` builds missing ones but never drops
 * retired ones, which is the whole reason `syncIndexes` is called at boot.
 */
const MODELS = [
  require('../models/Person'),
  require('../models/Course'),
  require('../models/LectureSession'),
  require('../models/Attendance'),
  require('../models/AttendanceAttempt'),
  require('../models/BleToken'),
  require('../models/ManualCode'),
  require('../models/Settings'),
  require('../models/Geofence'),
  require('../models/AuditLog'),
];

/**
 * Collections this codebase used to write and no longer understands.
 *
 * `gpsfixbuffers` and `attemptverdicts` were folded into the single
 * `attendanceattempts` document. Nothing reads the old pair any more, and
 * nothing converts them either — there is deliberately no migration. Their
 * presence therefore means the database predates the current code, so the
 * server refuses to start rather than run against half a schema it will
 * silently ignore. Dropping them is the fix; the data was never worth more than
 * the 90 seconds it described.
 */
const RETIRED_COLLECTIONS = ['gpsfixbuffers', 'attemptverdicts'];

async function connectDatabase() {
  mongoose.connection.on('disconnected', () => console.error('[mongo] disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[mongo] reconnected'));
  mongoose.connection.on('error', (err) => console.error('[mongo] error', err.message));
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log(`[mongo] connected to ${mongoose.connection.name}`);
}

/**
 * Refuses to run against a database shaped for an older release.
 *
 * One `listCollections` call, so it costs nothing at boot and cannot grow with
 * the collection the way a document scan would. It is deliberately a hard stop
 * in production: a server that starts against a stale schema does not fail, it
 * succeeds at the wrong thing, and the first sign is wrong attendance.
 *
 * @returns {Promise<string[]>} the retired collections found, for the caller to report.
 */
async function assertNoRetiredCollections() {
  const present = await mongoose.connection.db
    .listCollections({ name: { $in: RETIRED_COLLECTIONS } }, { nameOnly: true })
    .toArray();
  const names = present.map((c) => c.name);
  if (names.length === 0) return names;

  console.error(
    `[CRITICAL] This database still holds collections from an earlier schema: ${names.join(', ')}.\n`
    + '           Nothing migrates them and nothing reads them. Drop them and restart:\n'
    + names.map((n) => `             mongosh "${'<MONGO_URI>'}" --eval 'db.${n}.drop()'`).join('\n'),
  );
  if (isProd) process.exit(1);
  return names;
}

/**
 * Brings every collection's indexes in line with its schema.
 *
 * `syncIndexes` both creates what is missing and **drops what the schema no
 * longer declares**, which is the half `autoIndex` does not do — a retired
 * index would otherwise be maintained on every write forever, and a retired
 * *unique* index would keep rejecting writes the code considers legal.
 */
async function syncAllIndexes() {
  try {
    await Promise.all(MODELS.map((model) => model.syncIndexes()));
  } catch (err) {
    // A failed sync means queries may run without their expected indexes (full
    // collection scans under load) — surface loudly and refuse to run in prod.
    console.error('[CRITICAL] Index sync failed — queries may run without indexes:', err);
    if (isProd) process.exit(1);
  }
}

async function closeDatabase() {
  await mongoose.connection.close(false);
}

module.exports = {
  connectDatabase,
  assertNoRetiredCollections,
  syncAllIndexes,
  closeDatabase,
  RETIRED_COLLECTIONS,
};
