const mongoose = require('mongoose');
const { toMinutes, hasScheduleOverlap } = require('../utils/schedule');
const settingsService = require('../services/settings.service');

const ALLOWED_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const VERIFICATION_MODES = ['bluetooth', 'geofence', 'both'];

function validateSessionCreateBody(body) {
  const {
    lectureDay, startTime, endTime, recurring, verification, buildings,
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

  const mode = verification === undefined ? 'bluetooth' : String(verification);
  if (!VERIFICATION_MODES.includes(mode)) {
    return { ok: false, status: 400, error: 'verification must be "bluetooth", "geofence", or "both"' };
  }

  const buildingIds = Array.isArray(buildings) ? buildings.map(String) : [];
  if (mode !== 'bluetooth') {
    if (buildingIds.length === 0) {
      return { ok: false, status: 400, error: 'At least one building is required for geofence-based verification' };
    }
    if (buildingIds.some((id) => !mongoose.isValidObjectId(id))) {
      return { ok: false, status: 400, error: 'Invalid building id' };
    }
  }

  return {
    ok: true,
    lectureDay: dayUpper,
    startTime,
    endTime,
    recurring: Boolean(recurring),
    verification: mode,
    buildings: mode === 'bluetooth' ? [] : buildingIds,
  };
}

/** Async, mirrors checkSessionOverlap below: DB-backed rule, not a pure shape check. */
async function checkVerificationAllowed(verification) {
  const settings = await settingsService.getSettings();
  if (!settingsService.isVerificationAllowed(settings, verification)) {
    return {
      ok: false,
      status: 400,
      error: `Verification mode "${verification}" is disabled by the administrator`,
    };
  }
  return { ok: true };
}

/** Body for PATCH /:sessionId/broadcast — strictly `{ on: boolean }`. */
function validateBroadcastBody(body) {
  const on = body?.on;
  if (typeof on !== 'boolean') {
    return { ok: false, status: 400, error: 'on must be a boolean' };
  }
  return { ok: true, on };
}

async function checkSessionOverlap(LectureSession, courseId, day, startTime, endTime) {
  const sameDaySessions = await LectureSession.find({
    course: courseId,
    lectureDay: day,
    deleted: false,
  });
  const overlap = hasScheduleOverlap(sameDaySessions, day, startTime, endTime);
  if (overlap) {
    return { ok: false, status: 400, error: 'This session overlaps with an existing session for the same course' };
  }
  return { ok: true };
}

module.exports = {
  validateSessionCreateBody,
  validateBroadcastBody,
  checkSessionOverlap,
  checkVerificationAllowed,
  ALLOWED_DAYS,
  VERIFICATION_MODES,
};
