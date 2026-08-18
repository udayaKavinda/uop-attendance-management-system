const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const { DAY_INDEX, toMinutes } = require('../utils/schedule');
const { SESSION_RESOLVE_CACHE_TTL_MS, BROADCAST_STALE_MS } = require('../utils/constants');
const settingsService = require('./settings.service');
const { localYmd } = require('../utils/date');

// 5 s cache cuts repeated Course + LectureSession reads under 100-student polling load.
const _sessionResolveCache = new Map();

function getCurrentScheduleContext(now = new Date()) {
  return {
    day: DAY_INDEX[now.getDay()],
    currentMinutes: now.getHours() * 60 + now.getMinutes(),
  };
}

/**
 * Shared core: evaluates whether `now` falls inside a session's configured weekly
 * window. Returns a detailed { ok, reason } so both callers below stay in sync.
 */
function evaluateScheduleWindow(sessionConfig, now = new Date()) {
  const { day, currentMinutes } = getCurrentScheduleContext(now);
  const start = toMinutes(sessionConfig.startTime);
  const end = toMinutes(sessionConfig.endTime);
  if (start === null || end === null) return { ok: false, reason: 'Invalid schedule config' };
  if (day !== sessionConfig.lectureDay) {
    return { ok: false, reason: `Attendance allowed only on ${sessionConfig.lectureDay}` };
  }
  if (currentMinutes < start || currentMinutes > end) {
    return { ok: false, reason: 'Attendance allowed only within the configured lecture time' };
  }
  return { ok: true };
}

/** Single source of truth for whether a session is inside its weekly time window. */
function isWithinScheduleWindow(sessionItem, now = new Date()) {
  if (!sessionItem || !sessionItem.active || sessionItem.deleted) return false;
  if (!sessionItem.recurring && sessionItem.occurrenceDate
    && sessionItem.occurrenceDate !== localYmd(now)) return false;
  return evaluateScheduleWindow(sessionItem, now).ok;
}

function checkScheduleWindow(sessionConfig) {
  return evaluateScheduleWindow(sessionConfig);
}

/** Shared copy for staff broadcast toggle, token poll, and student admission. */
const BROADCAST_WINDOW_ERROR =
  'Broadcast can only run while this session is in its scheduled time window.';

/**
 * True iff the session's broadcast channel is open, inside its schedule window,
 * and its heartbeat is fresh. Read-time checks let students and polls fail fast
 * before the sweep job flips `broadcasting` off.
 */
function isBroadcastLive(sessionItem, now = Date.now()) {
  if (!sessionItem?.broadcasting) return false;
  if (!isWithinScheduleWindow(sessionItem, new Date(now))) return false;
  const seenAt = sessionItem.lastBroadcastSeenAt ? new Date(sessionItem.lastBroadcastSeenAt).getTime() : 0;
  return now - seenAt <= BROADCAST_STALE_MS;
}

/** Drops the cached active-session resolution for a course so state changes apply at once. */
function invalidateActiveSessionCache(courseId) {
  if (courseId == null) {
    _sessionResolveCache.clear();
    return;
  }
  _sessionResolveCache.delete(String(courseId));
}

async function resolveActiveSessionForCourse(courseId) {
  const cacheKey = String(courseId);
  const cached = _sessionResolveCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SESSION_RESOLVE_CACHE_TTL_MS) {
    return cached.value;
  }

  const course = await Course.findById(courseId);
  if (!course || !course.active) return { error: 'Invalid course' };
  const { day } = getCurrentScheduleContext();
  const sessions = await LectureSession.find({
    course: course._id,
    active: true,
    deleted: false,
    lectureDay: day,
  });
  const active = sessions.find((s) => isWithinScheduleWindow(s));
  if (!active) return { error: 'No active lecture session for this course now' };
  const result = { course, session: active };
  _sessionResolveCache.set(cacheKey, { value: result, ts: Date.now() });
  return result;
}

async function getRunningCoursesForStudent(now = new Date()) {
  const { day } = getCurrentScheduleContext(now);
  const sessions = await LectureSession.find({
    active: true,
    deleted: false,
    lectureDay: day,
  }).populate('course', 'code name active batch');

  const settings = await settingsService.getSettings();
  const manualCodeAllowed = Boolean(settings.manualCodeAllowed);
  const runningCourses = new Map();
  sessions.forEach((s) => {
    if (!s.course?.active) return;
    if (!isWithinScheduleWindow(s, now)) return;
    if (!settingsService.isVerificationAllowed(settings, s.verification || 'bluetooth')) return;
    runningCourses.set(String(s.course._id), {
      _id: s.course._id,
      code: s.course.code,
      batch: s.course.batch,
      name: s.course.name,
      verification: s.verification || 'bluetooth',
      // Lets the app offer "Enter attendance code" alongside the automatic BLE
      // scan — independent of whether the lecturer's broadcast is actually on,
      // but gated by the global kill-switch regardless of the session's own setting.
      manualCodeEnabled: manualCodeAllowed && Boolean(s.manualCodeEnabled),
    });
  });

  return Array.from(runningCourses.values()).sort((a, b) => {
    const c = String(a.code).localeCompare(String(b.code));
    if (c !== 0) return c;
    return String(a.batch || '').localeCompare(String(b.batch || ''));
  });
}

async function getRunningSessionsForStaff(scope, now = new Date()) {
  const { day } = getCurrentScheduleContext(now);
  const sessions = await LectureSession.find({
    deleted: false,
    active: true,
    lectureDay: day,
    ...scope,
  }).populate('course', 'active');

  return sessions
    .filter((s) => s.course?.active && isWithinScheduleWindow(s, now))
    .map((s) => ({
      sessionId: String(s._id),
      // Raw flag (not staleness-checked): the dashboard uses it to reconcile —
      // auto-resume the broadcast or turn it off on the server.
      broadcasting: Boolean(s.broadcasting),
      deviceName: s.bluetoothDeviceName || null,
    }));
}

module.exports = {
  BROADCAST_WINDOW_ERROR,
  isWithinScheduleWindow,
  checkScheduleWindow,
  isBroadcastLive,
  invalidateActiveSessionCache,
  resolveActiveSessionForCourse,
  getRunningCoursesForStudent,
  getRunningSessionsForStaff,
};
