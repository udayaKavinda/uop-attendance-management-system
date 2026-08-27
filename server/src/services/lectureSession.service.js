const LectureSession = require('../models/LectureSession');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const Geofence = require('../models/Geofence');
const bluetoothCode = require('./bluetoothCode.service');
const manualCode = require('./manualCode.service');
const settingsService = require('./settings.service');
const {
  validateSessionCreateBody, checkSessionOverlap,
} = require('../validators/session.validator');
const { staffSessionMatch } = require('./auth.service');
const { localYmd } = require('../utils/date');
const { DAY_INDEX, toMinutes, nextOccurrenceDate } = require('../utils/schedule');
const {
  BROADCAST_WINDOW_ERROR,
  invalidateActiveSessionCache,
  isWithinScheduleWindow,
  isScheduledNow,
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

  const found = await Geofence.countDocuments({
    _id: { $in: validated.buildings },
    deleted: false,
    active: true,
  });
  if (found !== validated.buildings.length) {
    return { ok: false, status: 400, error: 'One or more buildings were not found' };
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
    buildings: validated.buildings,
    manualCodeRotationMode: validated.manualCodeRotationMode,
    manualCodeRotationSeconds: validated.manualCodeRotationSeconds,
    // Collecting (active: true) always starts from an explicit Collect tap inside
    // the session's own scheduled window — never automatically at creation time,
    // even if the session happens to be created during a window that's already live.
    active: false,
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

/**
 * "Collect" — the only way a session becomes active. Requires being inside the
 * session's own scheduled window right now: collecting attendance outside class
 * time makes no sense, and the card's Collect control is disabled to match this
 * everywhere except here, this is the server-side invariant backing that.
 */
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
  if (!isScheduledNow(sessionItem)) {
    return { ok: false, status: 400, error: BROADCAST_WINDOW_ERROR };
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

/**
 * Sort key for "soonest/currently-running first": a session running right now
 * ranks at the very top (0); otherwise it's the epoch ms of its next
 * occurrence's start time. One-time sessions use their fixed `occurrenceDate`
 * directly instead of the weekly `nextOccurrenceDate` walk.
 */
function sessionSortRank(sessionItem, now = new Date()) {
  const startMin = toMinutes(sessionItem.startTime);
  const endMin = toMinutes(sessionItem.endTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Whether the session's own day is today — NOT "does nextOccurrenceDate return the
  // same string with and without an endTime hint", which was the previous check. That
  // comparison only ever disagrees in the one case where today's occurrence already
  // ended (endTime rolls it a week forward); for every OTHER day of the week it always
  // agrees, so it evaluated to true for literally any session whose time-of-day window
  // happened to overlap the current clock time, regardless of which weekday it was
  // actually configured for — a Thursday-only session was ranking as "running now" on
  // a Friday whenever the wall-clock time fell inside its start/end range.
  const isToday = sessionItem.recurring
    ? sessionItem.lectureDay === DAY_INDEX[now.getDay()]
    : sessionItem.occurrenceDate === localYmd(now);

  if (isToday && startMin !== null && endMin !== null && nowMin >= startMin && nowMin <= endMin) {
    return 0; // running right now
  }

  const dateStr = sessionItem.recurring
    ? nextOccurrenceDate(sessionItem.lectureDay, now, sessionItem.endTime)
    : sessionItem.occurrenceDate;
  if (!dateStr) return Number.MAX_SAFE_INTEGER;

  const [y, m, d] = dateStr.split('-').map(Number);
  const startOfDay = new Date(y, (m || 1) - 1, d || 1).getTime();
  return startOfDay + (startMin || 0) * 60_000;
}

/**
 * `pagination` omitted (or `hasLimit: false`) returns every matching session,
 * sorted soonest-first, as before. The soonest-first order depends on the
 * current time and each session's weekly schedule, which isn't expressible as
 * a Mongo sort — so pagination here slices the already-sorted in-memory list
 * rather than pushing skip/limit down to the query.
 */
async function listAllForStaff(auth, pagination) {
  const scope = await staffSessionMatch(auth.person, auth.isAdmin);
  const sessions = await LectureSession.find({ deleted: false, ...scope })
    .populate('course', 'code name active batch lecturers');
  const now = new Date();
  const sorted = sessions
    .map((s) => ({ s, rank: sessionSortRank(s, now) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ s }) => s);

  if (!pagination || !pagination.hasLimit) return sorted;

  const { page, limit } = pagination;
  const start = (page - 1) * limit;
  return {
    items: sorted.slice(start, start + limit),
    total: sorted.length,
    page,
    limit,
    hasMore: start + limit < sorted.length,
  };
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
  if (!await settingsService.isBleEnabled()) {
    return { ok: false, status: 403, error: 'Bluetooth is switched off by the administrator.' };
  }
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
