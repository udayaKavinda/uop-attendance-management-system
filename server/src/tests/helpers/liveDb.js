'use strict';

/**
 * Shared setup for the suites that talk to a real MongoDB.
 *
 * Two things live here, and the second one is the reason this file exists.
 *
 * **A safety guard.** These suites destroy the database they are pointed at, so
 * they refuse to run against the one the application itself uses rather than
 * quietly deleting a developer's data because two URIs looked similar.
 *
 * **One database per suite.** Jest runs suites in parallel workers unless told
 * otherwise, and `npm test` does not tell it otherwise — only the documented
 * `npm test -- --runInBand` does. Every live suite used to share the single
 * `uop_attendance_test` database, and `dbIntegration` calls `dropDatabase()` in
 * its own `beforeAll`/`afterAll`. Dropping a database takes its **indexes** with
 * it, so a parallel `gpsStateDurability` lost the unique `(student, session)`
 * index and the TTL index it exists to assert, mid-run. Measured on a machine
 * with a local mongod: `npx jest` failed on 4, 7 and 6 tests across three
 * consecutive runs — always in `gpsStateDurability`, never the same set twice,
 * and always green again under `--runInBand`. A race that only shows up in the
 * command the README does *not* use is worse than one that always fails, so the
 * isolation is enforced here instead of relying on the flag.
 *
 * Suffixing the database name is enough: each suite gets its own namespace, so
 * dropping one cannot touch another and the flag becomes an optimisation rather
 * than a correctness requirement.
 */

function databaseNameOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(String(uri || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * The URI this suite should use, or '' when no live database is configured.
 *
 * @param {string} suiteName short slug appended to the database name, e.g. 'bands'
 * @returns {string}
 */
function liveDbUri(suiteName) {
  const base = process.env.MONGO_TEST_URI || '';
  if (!base) return '';

  const testDb = databaseNameOf(base);
  const appDb = databaseNameOf(process.env.MONGO_URI || 'mongodb://localhost:27017/attendance');
  if (!testDb || testDb === appDb) {
    throw new Error(
      `[liveDb] refusing to run: MONGO_TEST_URI points at "${testDb || '(no database)'}", `
      + 'which is the database the application uses. These suites drop the database they '
      + 'connect to — point it at a scratch name such as uop_attendance_test.',
    );
  }

  const suffixed = `${testDb}_${suiteName}`;
  return base.replace(`/${testDb}`, `/${suffixed}`);
}

/**
 * `describe` when a live database is configured, `describe.skip` otherwise, so a
 * machine or CI runner without a mongod still runs a green suite.
 */
function describeLive(uri, suiteName) {
  if (!uri) {
    // eslint-disable-next-line no-console
    console.warn(`[${suiteName}] no MONGO_TEST_URI — skipping live-database suite.`);
    return describe.skip;
  }
  return describe;
}

module.exports = { databaseNameOf, liveDbUri, describeLive };
