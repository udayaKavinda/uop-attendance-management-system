'use strict';

/**
 * In-memory stand-in for the AttendanceAttempt collection.
 *
 * Route suites mock every model, and this one is reached indirectly through
 * attendance.service, so without it those tests hang on a database the suite
 * never connects to. It implements only the operations the two services
 * actually issue — deliberately, because a fake that tries to be a general
 * query engine is a second implementation to get wrong.
 *
 * It proves nothing about MongoDB's own behaviour. `$push`/`$slice` atomicity,
 * the unique index and TTL expiry are verified against a real server in
 * gpsStateDurability.test.js, which is the only place that can honestly test
 * them.
 */

function keyOf(filter) {
  return `${filter.student}:${filter.session}`;
}

function blank(filter) {
  return {
    _id: keyOf(filter),
    student: filter.student,
    session: filter.session,
    fixes: [],
    band: null,
    centroid: null,
    distanceM: null,
    verdictTs: null,
  };
}

function makeAttendanceAttemptModel() {
  const store = new Map();

  const find = (filter) => (filter._id
    ? [...store.values()].find((d) => d._id === filter._id)
    : store.get(keyOf(filter))) || null;

  return {
    __store: store,

    async findOneAndUpdate(filter, update, _opts) {
      const key = keyOf(filter);
      const doc = store.get(key) || blank(filter);
      const push = update?.$push?.fixes;
      if (push) {
        doc.fixes = doc.fixes.concat(push.$each || []);
        if (typeof push.$slice === 'number' && push.$slice < 0) {
          doc.fixes = doc.fixes.slice(push.$slice);
        }
      }
      Object.assign(doc, update?.$set || {});
      store.set(key, doc);
      return doc;
    },

    async findOne(filter) {
      return find(filter);
    },

    async updateOne(filter, update) {
      const doc = find(filter);
      if (!doc) return { modifiedCount: 0 };
      Object.assign(doc, update?.$set || {});
      return { modifiedCount: 1 };
    },

    /** Only the verdict sweep's shape: clear verdicts older than a cutoff. */
    async updateMany(query, update) {
      const cutoff = query?.verdictTs?.$lt;
      let modified = 0;
      for (const doc of store.values()) {
        if (doc.verdictTs != null && cutoff !== undefined && doc.verdictTs < cutoff) {
          Object.assign(doc, update?.$set || {});
          modified += 1;
        }
      }
      return { modifiedCount: modified };
    },

    async deleteOne(filter) {
      const key = filter._id || keyOf(filter);
      const existed = store.delete(key);
      return { deletedCount: existed ? 1 : 0 };
    },

    /**
     * Only the whole-document sweep's shape: no live fix AND no live verdict.
     * Both halves matter — dropping a row on stale fixes alone would discard a
     * verdict a student is still on their way to use.
     */
    async deleteMany(query) {
      const fixCutoff = query?.$nor?.[0]?.fixes?.$elemMatch?.ts?.$gt;
      const verdictCutoff = query?.$or?.[1]?.verdictTs?.$lte;
      let deleted = 0;
      for (const [k, doc] of [...store]) {
        const hasLiveFix = fixCutoff === undefined
          ? false
          : (doc.fixes || []).some((f) => f.ts > fixCutoff);
        const hasLiveVerdict = doc.verdictTs != null
          && verdictCutoff !== undefined && doc.verdictTs > verdictCutoff;
        if (!hasLiveFix && !hasLiveVerdict) { store.delete(k); deleted += 1; }
      }
      return { deletedCount: deleted };
    },

    __reset() { store.clear(); },
  };
}

module.exports = { makeAttendanceAttemptModel };
