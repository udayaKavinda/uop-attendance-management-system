const mongoose = require('mongoose');
const { toMinutes, hasScheduleOverlap, ymd } = require('../utils/schedule');
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

/** Body for PATCH /:sessionId/reviews/:attendanceId — strictly approve or reject. */
function validateReviewBody(body) {
  const decision = String(body?.decision || '');
  if (!['approve', 'reject'].includes(decision)) {
    return { ok: false, status: 400, error: 'decision must be "approve" or "reject"' };
  }
  return { ok: true, decision };
}

async function checkSessionOverlap(LectureSession, courseId, day, startTime, endTime) {
  const sameDaySessions = await LectureSession.find({
    course: courseId,
    lectureDay: day,
    deleted: false,
  });
  const today = ymd();
  const relevant = sameDaySessions.filter(
    (session) => session.recurring || session.occurrenceDate >= today,
  );
  const overlap = hasScheduleOverlap(relevant, day, startTime, endTime);
  if (overlap) {
    return { ok: false, status: 400, error: 'This session overlaps with an existing session for the same course' };
  }
  return { ok: true };
}

module.exports = {
  validateSessionCreateBody,
  validateBroadcastBody,
  validateReviewBody,
  checkSessionOverlap,
  ALLOWED_DAYS,
};
