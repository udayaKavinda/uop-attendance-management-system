'use strict';

/**
 * In-memory stand-ins for the two collections that hold live attempt state.
 *
 * Route suites mock every model, and these two are reached indirectly through
 * attendance.service, so without them those tests hang on a database that the
 * suite never connects to. They implement only the operations the services
 * actually issue — deliberately, because a fake that tries to be a general query
 * engine is a second implementation to get wrong.
 *
 * These prove nothing about MongoDB's own behaviour. `$push`/`$slice` atomicity,
 * the unique index, and TTL expiry are verified against a real server in
 * dbIntegration.test.js, which is the only place that can honestly test them.
 */

function keyOf(filter) {
  return `${filter.student}:${filter.session}`;
}

/** Mirrors GpsFixBuffer: upserting $push with a trailing $slice cap. */
function makeFixBufferModel() {
  const store = new Map();

  return {
    __store: store,
    async findOneAndUpdate(filter, update, _opts) {
      const key = keyOf(filter);
      const doc = store.get(key) || { student: filter.student, session: filter.session, fixes: [] };
      const push = update?.$push?.fixes;
      if (push) {
        doc.fixes = doc.fixes.concat(push.$each || []);
        if (typeof push.$slice === 'number' && push.$slice < 0) {
          doc.fixes = doc.fixes.slice(push.$slice);
        }
      }
      store.set(key, doc);
      return doc;
    },
    async findOne(filter) {
      return store.get(keyOf(filter)) || null;
    },
    async deleteOne(filter) {
      const existed = store.delete(keyOf(filter));
      return { deletedCount: existed ? 1 : 0 };
    },
    /** Only the sweep's shape: "no fix newer than cutoff". */
    async deleteMany(query) {
      const cutoff = query?.$nor?.[0]?.fixes?.$elemMatch?.ts?.$gt;
      let deleted = 0;
      for (const [k, doc] of [...store]) {
        const hasLive = cutoff === undefined
          ? false
          : (doc.fixes || []).some((f) => f.ts > cutoff);
        if (!hasLive) { store.delete(k); deleted += 1; }
      }
      return { deletedCount: deleted };
    },
    __reset() { store.clear(); },
  };
}

/** Mirrors AttemptVerdict: upserting $set, keyed by (student, session). */
function makeVerdictModel() {
  const store = new Map();

  return {
    __store: store,
    async findOneAndUpdate(filter, update, _opts) {
      const key = keyOf(filter);
      const doc = {
        _id: key,
        student: filter.student,
        session: filter.session,
        ...(store.get(key) || {}),
        ...(update?.$set || {}),
      };
      store.set(key, doc);
      return doc;
    },
    async findOne(filter) {
      return store.get(keyOf(filter)) || null;
    },
    async deleteOne(filter) {
      const key = filter._id || keyOf(filter);
      const existed = store.delete(key);
      return { deletedCount: existed ? 1 : 0 };
    },
    /** Only the sweep's shape: ts older than a cutoff. */
    async deleteMany(query) {
      const cutoff = query?.ts?.$lt;
      let deleted = 0;
      for (const [k, doc] of [...store]) {
        if (cutoff !== undefined && doc.ts < cutoff) { store.delete(k); deleted += 1; }
      }
      return { deletedCount: deleted };
    },
    __reset() { store.clear(); },
  };
}

module.exports = { makeFixBufferModel, makeVerdictModel };
