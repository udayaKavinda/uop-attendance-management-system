const mongoose = require('mongoose');
const { toMinutes, hasScheduleOverlap, ymd } = require('../utils/schedule');
const settingsService = require('../services/settings.service');
const { MIN_ROTATION_SECONDS, MAX_ROTATION_SECONDS } = require('../services/manualCode.service');

const ALLOWED_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const VERIFICATION_MODES = ['bluetooth', 'geofence', 'both'];

function validateSessionCreateBody(body) {
  const {
    lectureDay, startTime, endTime, recurring, verification, buildings,
    manualCodeEnabled, manualCodeRotationMode, manualCodeRotationSeconds,
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

  const mode = String(verification || '');
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

  if (manualCodeEnabled !== undefined && typeof manualCodeEnabled !== 'boolean') {
    return { ok: false, status: 400, error: 'manualCodeEnabled must be a boolean' };
  }
  const manualEnabled = Boolean(manualCodeEnabled);
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
    verification: mode,
    buildings: mode === 'bluetooth' ? [] : buildingIds,
    manualCodeEnabled: manualEnabled,
    manualCodeRotationMode: rotationMode,
    manualCodeRotationSeconds: rotationSeconds,
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
  checkSessionOverlap,
  checkVerificationAllowed,
  ALLOWED_DAYS,
  VERIFICATION_MODES,
};
