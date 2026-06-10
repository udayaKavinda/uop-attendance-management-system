const { toMinutes, hasScheduleOverlap } = require('../utils/schedule');

const ALLOWED_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function validateSessionCreateBody(body) {
  const {
    lectureDay, startTime, endTime, recurring,
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
  return {
    ok: true,
    lectureDay: dayUpper,
    startTime,
    endTime,
    recurring: Boolean(recurring),
  };
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
  checkSessionOverlap,
  ALLOWED_DAYS,
};
