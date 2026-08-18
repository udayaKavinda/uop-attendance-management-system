const LectureSession = require('../models/LectureSession');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const Geofence = require('../models/Geofence');
const bluetoothCode = require('./bluetoothCode.service');
const manualCode = require('./manualCode.service');
const settingsService = require('./settings.service');
const {
  validateSessionCreateBody, checkSessionOverlap, checkVerificationAllowed,
} = require('../validators/session.validator');
const { staffSessionMatch } = require('./auth.service');
const { localYmd } = require('../utils/date');
const { toMinutes, nextOccurrenceDate } = require('../utils/schedule');
const {
  BROADCAST_WINDOW_ERROR,
  invalidateActiveSessionCache,
  isWithinScheduleWindow,
} = require('./session.service');

async function createSession(course, body) {
  const validated = validateSessionCreateBody(body);
  if (!validated.ok) return validated;
  if (!course.active) return { ok: false, status: 409, error: 'Cannot add sessions to a disabled course' };
  const overlap = await checkSessionOverlap(
    LectureSession,
    course._id,
    validated.lectureDay,
    validated.startTime,
    validated.endTime
  );
  if (!overlap.ok) return overlap;

  const modeGate = await checkVerificationAllowed(validated.verification);
  if (!modeGate.ok) return modeGate;
  if (validated.manualCodeEnabled && !await settingsService.isManualCodeAllowed()) {
    return { ok: false, status: 403, error: 'Manual attendance codes are disabled by the administrator' };
  }

  if (validated.buildings.length > 0) {
    const found = await Geofence.countDocuments({
      _id: { $in: validated.buildings },
      deleted: false,
      active: true,
    });
    if (found !== validated.buildings.length) {
      return { ok: false, status: 400, error: 'One or more buildings were not found' };
    }
  }

  const created = await LectureSession.create({
    course: course._id,
    lectureDay: validated.lectureDay,
    startTime: validated.startTime,
    endTime: validated.endTime,
    recurring: validated.recurring,
    occurrenceDate: validated.recurring
      ? null
      : nextOccurrenceDate(validated.lectureDay, new Date(), validated.endTime),
    verification: validated.verification,
    buildings: validated.buildings,
    manualCodeEnabled: validated.manualCodeEnabled,
    manualCodeRotationMode: validated.manualCodeRotationMode,
    manualCodeRotationSeconds: validated.manualCodeRotationSeconds,
    active: true,
  });
  return { ok: true, session: created };
}

async function findSessionById(sessionId) {
  return LectureSession.findOne({ _id: sessionId, deleted: false });
}

async function softDeleteSession(sessionItem) {
  sessionItem.deleted = true;
  sessionItem.active = false;
  sessionItem.broadcasting = false;
  sessionItem.lastBroadcastSeenAt = null;
  await sessionItem.save();
  await bluetoothCode.removeToken(String(sessionItem._id));
  await manualCode.removeCode(sessionItem);
  invalidateActiveSessionCache(sessionItem.course);
  return { ok: true };
}

async function activateSession(sessionItem) {
  // `course` may be a populated doc (activate route) or an ObjectId ref. Resolve
  // it either way so activation never depends on the guard's populate behavior.
  const course = sessionItem.populated && sessionItem.populated('course')
    ? sessionItem.course
    : await Course.findById(sessionItem.course);
  if (!course?.active) return { ok: false, status: 400, error: 'Course is disabled' };
  if (typeof sessionItem.recurring !== 'boolean'
    || (sessionItem.recurring === false && !sessionItem.occurrenceDate)) {
    return { ok: false, status: 409, error: 'Session data does not match the current schema.' };
  }
  if (sessionItem.recurring === false && sessionItem.occurrenceDate < localYmd()) {
    return { ok: false, status: 400, error: 'This one-time session has expired; create a new session.' };
  }
  sessionItem.active = true;
  await sessionItem.save();
  invalidateActiveSessionCache(course._id);
  return { ok: true, session: sessionItem };
}

async function deactivateSession(sessionItem) {
  sessionItem.active = false;
  sessionItem.broadcasting = false;
  sessionItem.lastBroadcastSeenAt = null;
  await sessionItem.save();
  await bluetoothCode.removeToken(String(sessionItem._id));
  await manualCode.removeCode(sessionItem);
  invalidateActiveSessionCache(sessionItem.course);
  return { ok: true, session: sessionItem };
}

async function listAllForStaff(auth) {
  const scope = await staffSessionMatch(auth.person, auth.isAdmin);
  return LectureSession.find({ deleted: false, ...scope })
    .populate('course', 'code name active batch lecturers')
    .sort({ updatedAt: -1 });
}

async function resolveCourseForSession(sessionItem) {
  if (sessionItem.populated?.('course') && sessionItem.course) return sessionItem.course;
  return Course.findById(sessionItem.course);
}

/** Whether a broadcast may be started or kept alive right now (active, course on, in window). */
async function assertCanBroadcastNow(sessionItem, now = new Date()) {
  if (!sessionItem || sessionItem.deleted) {
    return { ok: false, status: 400, error: 'Session not found' };
  }
  if (!sessionItem.active) {
    return { ok: false, status: 400, error: 'Session is not active' };
  }
  const verification = sessionItem.verification;
  if (verification !== 'bluetooth' && verification !== 'both') {
    return { ok: false, status: 400, error: 'Bluetooth broadcast is not allowed for this session.' };
  }
  const modeGate = await checkVerificationAllowed(verification);
  if (!modeGate.ok) return modeGate;
  const course = await resolveCourseForSession(sessionItem);
  if (!course?.active) {
    return { ok: false, status: 400, error: 'Course is disabled' };
  }
  if (!isWithinScheduleWindow(sessionItem, now)) {
    return { ok: false, status: 400, error: BROADCAST_WINDOW_ERROR };
  }
  return { ok: true, course };
}

/** Turns broadcast off and removes the rotating token. Idempotent. */
async function closeBroadcast(sessionItem) {
  if (!sessionItem.broadcasting) return;
  sessionItem.broadcasting = false;
  sessionItem.lastBroadcastSeenAt = null;
  await sessionItem.save();
  await bluetoothCode.removeToken(String(sessionItem._id));
  invalidateActiveSessionCache(sessionItem.course);
}

/**
 * Idempotent on/off switch for the session's BLE attendance broadcast.
 * On: requires active session + enabled course + schedule window; seeds token.
 * Off: closes the channel unconditionally.
 */
async function setBroadcasting(sessionItem, on) {
  if (on) {
    const gate = await assertCanBroadcastNow(sessionItem);
    if (!gate.ok) return gate;
    sessionItem.broadcasting = true;
    // Stamp immediately so the channel counts as live before the first token poll.
    sessionItem.lastBroadcastSeenAt = new Date();
    await sessionItem.save();
    await bluetoothCode.getToken(String(sessionItem._id));
  } else {
    await closeBroadcast(sessionItem);
  }
  invalidateActiveSessionCache(sessionItem.course);
  return { ok: true, session: sessionItem };
}

/**
 * Current token for the broadcasting phone. Each poll doubles as the heartbeat.
 * Rejects (and auto-closes) when the session leaves its schedule window.
 */
async function getBroadcast(sessionItem) {
  if (!sessionItem.broadcasting) {
    return { ok: false, status: 400, error: 'Broadcast is not on for this session' };
  }
  const gate = await assertCanBroadcastNow(sessionItem);
  if (!gate.ok) {
    await closeBroadcast(sessionItem);
    return gate;
  }
  sessionItem.lastBroadcastSeenAt = new Date();
  await sessionItem.save();
  const { token, rotatesIn } = await bluetoothCode.getToken(String(sessionItem._id));

  // Surfaced in the Android foreground-service notification and dashboard card so the
  // broadcast is visibly doing something user-perceptible while backgrounded (Play FGS
  // policy) — a live "students marked" count and time-remaining, not the raw token.
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const endMinutes = toMinutes(sessionItem.endTime);
  const minutesRemaining = endMinutes === null ? null : Math.max(0, endMinutes - currentMinutes);
  const attendanceCount = await Attendance.countDocuments({
    session: sessionItem._id,
    attendanceDate: localYmd(now),
  });

  return {
    ok: true,
    data: {
      sessionId: sessionItem._id,
      broadcasting: true,
      token,
      rotatesIn,
      rotationMs: bluetoothCode.ROTATION_MS,
      attendanceCount,
      minutesRemaining,
    },
  };
}

module.exports = {
  createSession,
  findSessionById,
  softDeleteSession,
  activateSession,
  deactivateSession,
  listAllForStaff,
  assertCanBroadcastNow,
  closeBroadcast,
  setBroadcasting,
  getBroadcast,
};
