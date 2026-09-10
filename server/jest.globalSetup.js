'use strict';

/**
 * Picks up a local MongoDB automatically so `npm test` runs the live-database
 * suite without anyone having to remember an environment variable, and skips it
 * cleanly on a machine (or CI runner) that has no mongod.
 *
 * The database NAME is hard-coded, never derived from MONGO_URI. dbIntegration
 * drops whatever database it is pointed at, so the one thing this must never do
 * is inherit the name the application itself uses.
 */

const TEST_DB = 'uop_attendance_test';
const DEFAULT_HOST = 'mongodb://127.0.0.1:27017';
const PROBE_TIMEOUT_MS = 1500;

module.exports = async function globalSetup() {
  // Explicit opt-out. Without it there is no way to say "do not look for a
  // database": an unset or empty MONGO_TEST_URI means "probe localhost", which is
  // wrong on a machine that happens to BE the production host — CI runs on the
  // deploy target, and a test process must never open a connection there.
  if (process.env.MONGO_TEST_URI === 'off') {
    process.env.MONGO_TEST_URI = '';
    return;
  }
  if (process.env.MONGO_TEST_URI) return;

  const mongoose = require('mongoose');
  const uri = `${DEFAULT_HOST}/${TEST_DB}`;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
      connectTimeoutMS: PROBE_TIMEOUT_MS,
    });
    await mongoose.disconnect();
    process.env.MONGO_TEST_URI = uri;
  } catch {
    // No local mongod — dbIntegration skips itself and the rest of the suite runs.
    process.env.MONGO_TEST_URI = '';
  }
};
