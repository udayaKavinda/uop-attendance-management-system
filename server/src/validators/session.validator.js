const mongoose = require('mongoose');
const { toMinutes, findScheduleOverlap, isNonRecurringExpired } = require('../utils/schedule');
const { MIN_ROTATION_SECONDS, MAX_ROTATION_SECONDS } = require('../services/manualCode.service');

const ALLOWED_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function validateSessionCreateBody(body) {
  const {
    lectureDay, startTime, endTime, recurring, buildings,
    manualCodeRotationMode, manualCodeRotationSeconds,
  } = body || {};
  const dayUpper = String(lectureDay || '').toUpperCase();
  if (!ALLOWED_DAYS.includes(dayUpper)) {
    return { ok: false, status: 400, error: 'lectureDay must be MON..SUN' };
  }
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  if (s === null || e === null || s >= e) {
    return { ok: false, status: 400, error: 'Invalid startTime/endTime (HH:mm)' };
  }
  if (typeof recurring !== 'boolean') {
    return { ok: false, status: 400, error: 'recurring must be a boolean' };
  }

  // Mandatory: every session verifies by GPS, so a session with no polygon could
  // never place a student in a passing band and would send the whole class to
  // the lecturer's review queue.
  const buildingIds = Array.isArray(buildings) ? buildings.map(String) : [];
  if (buildingIds.length === 0) {
    return { ok: false, status: 400, error: 'Select at least one building for this session' };
  }
  if (buildingIds.some((id) => !mongoose.isValidObjectId(id))) {
    return { ok: false, status: 400, error: 'Invalid building id' };
  }

  const rotationMode = manualCodeRotationMode === undefined ? 'none' : String(manualCodeRotationMode);
  if (!['none', 'interval'].includes(rotationMode)) {
    return { ok: false, status: 400, error: 'manualCodeRotationMode must be "none" or "interval"' };
  }
  let rotationSeconds = Number(manualCodeRotationSeconds ?? 60);
  if (!Number.isFinite(rotationSeconds)
    || rotationSeconds < MIN_ROTATION_SECONDS
    || rotationSeconds > MAX_ROTATION_SECONDS) {
    return {
      ok: false,
      status: 400,
      error: `manualCodeRotationSeconds must be between ${MIN_ROTATION_SECONDS} and ${MAX_ROTATION_SECONDS}`,
    };
  }
  rotationSeconds = Math.round(rotationSeconds);

  return {
    ok: true,
    lectureDay: dayUpper,
    startTime,
    endTime,
    recurring,
    buildings: buildingIds,
    manualCodeRotationMode: rotationMode,
    manualCodeRotationSeconds: rotationSeconds,
  };
}

/** Body for PATCH /:sessionId/broadcast — strictly `{ on: boolean }`. */
function validateBroadcastBody(body) {
  const on = body?.on;
  if (typeof on !== 'boolean') {
    return { ok: false, status: 400, error: 'on must be a boolean' };
  }
  return { ok: true, on };
}

/**
 * `occurrenceDate` is the date the new session will land on (null when weekly).
 * The caller derives it BEFORE calling, so the clash check and the row that gets
 * written agree on one date — deriving it separately in each place lets a session
 * created on the end-time boundary be checked against one date and saved with
 * another.
 */
async function checkSessionOverlap(
  LectureSession, courseId, day, startTime, endTime, occurrenceDate = null,
) {
  const sameDaySessions = await LectureSession.find({
    course: courseId,
    lectureDay: day,
    deleted: false,
  });
  // Exactly the rule listAllForStaff hides cards by, so the clash check can only
  // ever cite a session the lecturer can actually see. It used to drop one-time
  // sessions by date alone (`occurrenceDate >= today`), which kept THIS MORNING's
  // spent session in the comparison while the Sessions tab had already hidden it:
  // the lecturer was blocked by an invisible row and told to "delete the other
  // session first", with no way to reach it. Deliberately stricter than
  // isNonRecurringExpired on its own so a malformed row (no `recurring`, or no
  // date) stays in the comparison instead of quietly disappearing from it.
  const now = new Date();
  const isSpentOneTime = (session) => session.recurring === false
    && Boolean(session.occurrenceDate)
    && isNonRecurringExpired(session, now);
  const relevant = sameDaySessions.filter((session) => !isSpentOneTime(session));
  const clash = findScheduleOverlap(relevant, day, startTime, endTime, occurrenceDate);
  if (clash) {
    const kind = clash.recurring ? 'weekly' : `one-time on ${clash.occurrenceDate}`;
    return {
      ok: false,
      status: 400,
      error: `${startTime}-${endTime} clashes with this course's existing ${day} session `
        + `at ${clash.startTime}-${clash.endTime} (${kind}). `
        + 'Pick a time outside that range, or delete the other session first.',
    };
  }
  return { ok: true };
}

module.exports = {
  validateSessionCreateBody,
  validateBroadcastBody,
  checkSessionOverlap,
  ALLOWED_DAYS,
};
