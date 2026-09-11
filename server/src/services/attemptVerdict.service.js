/**
 * Remembers the last GPS band a student's automatic attempt reached, so that a
 * later "get help" code submission can be judged against it.
 *
 * It cannot read the fixes instead: those are dropped after 90 seconds, and by
 * the time a student reads the failure screen, asks the lecturer and types 8
 * digits, they are long gone. The verdict has to outlive them — which is why it
 * is expiry-checked against its own `verdictTs` and never against the fixes.
 *
 * Stored on the same AttendanceAttempt document as those fixes: same key, same
 * request, cleared together everywhere. Held in MongoDB rather than a
 * per-process Map, because as a Map it outlived the fixes but not a deploy — a
 * restart in the gap between the automatic attempt and the code submission
 * dropped the verdict, `get` returned null, and the caller correctly treats
 * null as `unknown`, so a student who had been measured inside the building was
 * written down as flagged.
 */

const AttendanceAttempt = require('../models/AttendanceAttempt');

const VERDICT_TTL_MS = 10 * 60 * 1000;

/** Overwrites with the latest verdict — the newest evidence is the truthful one. */
async function record(studentId, sessionId, { band, centroid = null, distanceM = null }) {
  await AttendanceAttempt.findOneAndUpdate(
    { student: String(studentId), session: String(sessionId) },
    {
      $set: {
        band,
        centroid: centroid || null,
        distanceM: Number.isFinite(distanceM) ? distanceM : null,
        verdictTs: Date.now(),
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
 * Freshness is decided here against `verdictTs`, not by the collection's TTL
 * index: MongoDB's TTL monitor runs on its own schedule, so a verdict that has
 * aged out could otherwise still be readable for up to a minute after it
 * expired. An attempt document with fixes but no band yet reads as null too —
 * there is no verdict to judge anything against until the fixes resolve.
 */
async function get(studentId, sessionId, now = Date.now()) {
  const rec = await AttendanceAttempt.findOne({
    student: String(studentId), session: String(sessionId),
  });
  if (!rec || !rec.band || !rec.verdictTs) return null;
  if (now - rec.verdictTs > VERDICT_TTL_MS) {
    // Clear the verdict rather than the document: the fixes may still be live,
    // and a fresh attempt can keep using the same row.
    await AttendanceAttempt.updateOne(
      { _id: rec._id },
      { $set: { band: null, centroid: null, distanceM: null, verdictTs: null } },
    );
    return null;
  }
  return {
    band: rec.band,
    centroid: rec.centroid ? rec.centroid.toObject?.() ?? rec.centroid : null,
    distanceM: rec.distanceM,
    ts: rec.verdictTs,
  };
}

/** Ends the attempt. Paired with gpsFix.clearFixes at every call site. */
async function clear(studentId, sessionId) {
  await AttendanceAttempt.deleteOne({
    student: String(studentId), session: String(sessionId),
  });
}

/**
 * Explicit cleanup of verdicts that have aged out, leaving any live fixes
 * alone. Whole-document removal is gpsFix.sweep's job, which requires both
 * halves to be dead; the collection's TTL index is the routine version.
 */
async function sweep(now = Date.now()) {
  const res = await AttendanceAttempt.updateMany(
    { verdictTs: { $ne: null, $lt: now - VERDICT_TTL_MS } },
    { $set: { band: null, centroid: null, distanceM: null, verdictTs: null } },
  );
  return res.modifiedCount || 0;
}

module.exports = {
  VERDICT_TTL_MS, record, get, clear, sweep,
};
