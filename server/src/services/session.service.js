const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const { DAY_INDEX, toMinutes } = require('../utils/schedule');
const { SESSION_RESOLVE_CACHE_TTL_MS, BROADCAST_STALE_MS } = require('../utils/constants');

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
  return evaluateScheduleWindow(sessionItem, now).ok;
}

function checkScheduleWindow(sessionConfig) {
  return evaluateScheduleWindow(sessionConfig);
}

/**
 * True iff the session's broadcast channel is open AND its heartbeat is fresh.
 * Read-time staleness check: even before the sweep job flips `broadcasting`
 * off, a dead broadcaster stops admitting attendance within BROADCAST_STALE_MS.
 */
function isBroadcastLive(sessionItem, now = Date.now()) {
  if (!sessionItem?.broadcasting) return false;
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

  const runningCourses = new Map();
  sessions.forEach((s) => {
    if (!s.course?.active) return;
    if (!isWithinScheduleWindow(s, now)) return;
    runningCourses.set(String(s.course._id), {
      _id: s.course._id,
      code: s.course.code,
      batch: s.course.batch,
      name: s.course.name,
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
  isWithinScheduleWindow,
  checkScheduleWindow,
  isBroadcastLive,
  invalidateActiveSessionCache,
  resolveActiveSessionForCourse,
  getRunningCoursesForStudent,
  getRunningSessionsForStaff,
};
