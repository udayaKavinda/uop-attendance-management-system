/**
 * Remembers the last GPS band a student's automatic attempt reached, so that a
 * later "get help" code submission can be judged against it.
 *
 * This cannot read the raw fix buffer instead: that buffer drops anything older
 * than the 90s window, and by the time a student reads the failure screen, asks
 * the lecturer and types 8 digits, their fixes are long gone. The verdict has to
 * outlive them.
 *
 * Held in MongoDB rather than a per-process Map. As a Map it did outlive the
 * fixes, but not a deploy: a restart in the gap between the automatic attempt
 * and the code submission dropped the verdict, `get` returned null, and the
 * caller — correctly — treats null as `unknown`, so a student who had been
 * measured inside the building was written down as flagged. It also pinned the
 * app to a single process, since a second instance would answer for a verdict
 * it had never recorded.
 */

const AttemptVerdict = require('../models/AttemptVerdict');

const VERDICT_TTL_MS = 10 * 60 * 1000;

/** Overwrites with the latest verdict — the newest evidence is the truthful one. */
async function record(studentId, sessionId, { band, centroid = null, distanceM = null }) {
  await AttemptVerdict.findOneAndUpdate(
    { student: String(studentId), session: String(sessionId) },
    {
      $set: {
        band,
        centroid: centroid || null,
        distanceM: Number.isFinite(distanceM) ? distanceM : null,
        ts: Date.now(),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

/**
 * Returns the stored verdict, or null when there is none — which happens when
 * the student never produced a usable fix at all (location denied, no provider,
 * indoors with no lock). Callers must treat null as `unknown`, not as a pass.
 *
 * Freshness is decided here against `ts`, not by the collection's TTL index:
 * MongoDB's TTL monitor runs on its own schedule, so a verdict that has aged
 * out could otherwise still be readable for up to a minute after it expired.
 */
async function get(studentId, sessionId, now = Date.now()) {
  const rec = await AttemptVerdict.findOne({
    student: String(studentId), session: String(sessionId),
  });
  if (!rec) return null;
  if (now - rec.ts > VERDICT_TTL_MS) {
    await AttemptVerdict.deleteOne({ _id: rec._id });
    return null;
  }
  return {
    band: rec.band,
    centroid: rec.centroid ? rec.centroid.toObject?.() ?? rec.centroid : null,
    distanceM: rec.distanceM,
    ts: rec.ts,
  };
}

async function clear(studentId, sessionId) {
  await AttemptVerdict.deleteOne({ student: String(studentId), session: String(sessionId) });
}

/** Explicit cleanup; the collection's TTL index is the routine one. */
async function sweep(now = Date.now()) {
  const res = await AttemptVerdict.deleteMany({ ts: { $lt: now - VERDICT_TTL_MS } });
  return res.deletedCount || 0;
}

module.exports = {
  VERDICT_TTL_MS, record, get, clear, sweep,
};
