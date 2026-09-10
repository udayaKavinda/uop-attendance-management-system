const { localYmd } = require('./date');

const DAY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toMinutes(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Next local calendar date matching `lectureDay`, including today. */
function nextOccurrenceDate(lectureDay, now = new Date(), endTime = null) {
  const target = DAY_INDEX.indexOf(String(lectureDay || '').toUpperCase());
  if (target < 0) return null;
  const result = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let daysAhead = (target - result.getDay() + 7) % 7;
  const end = toMinutes(endTime);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (daysAhead === 0 && end !== null && currentMinutes > end) daysAhead = 7;
  result.setDate(result.getDate() + daysAhead);
  return localYmd(result);
}

/**
 * The clashing session itself, not just "yes it clashes" — the caller turns it
 * into an error a lecturer can act on ("clashes with 10:00-12:00") instead of a
 * bare rejection that leaves them guessing which of their sessions is in the way.
 */
function findScheduleOverlap(existingSessions, day, startTime, endTime) {
  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);
  if (newStart === null || newEnd === null) return null;
  return existingSessions.find((s) => {
    if (s.lectureDay !== day) return false;
    const sStart = toMinutes(s.startTime);
    const sEnd = toMinutes(s.endTime);
    if (sStart === null || sEnd === null) return false;
    return sStart < newEnd && newStart < sEnd;
  }) || null;
}

function hasScheduleOverlap(existingSessions, day, startTime, endTime) {
  return findScheduleOverlap(existingSessions, day, startTime, endTime) !== null;
}

function isNonRecurringExpired(sessionItem, now = new Date()) {
  if (!sessionItem || sessionItem.recurring === true) return false;
  if (sessionItem.recurring !== false || !sessionItem.occurrenceDate) return true;
  const today = localYmd(now);
  if (today > sessionItem.occurrenceDate) return true;
  if (today < sessionItem.occurrenceDate) return false;
  const end = toMinutes(sessionItem.endTime);
  return end !== null && now.getHours() * 60 + now.getMinutes() > end;
}

module.exports = {
  DAY_INDEX,
  toMinutes,
  nextOccurrenceDate,
  hasScheduleOverlap,
  findScheduleOverlap,
  isNonRecurringExpired,
};
