const DAY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function hasScheduleOverlap(existingSessions, day, startTime, endTime) {
  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);
  if (newStart === null || newEnd === null) return false;
  return existingSessions.some((s) => {
    if (s.lectureDay !== day) return false;
    const sStart = toMinutes(s.startTime);
    const sEnd = toMinutes(s.endTime);
    if (sStart === null || sEnd === null) return false;
    return sStart < newEnd && newStart < sEnd;
  });
}

function isNonRecurringExpired(sessionItem, now = new Date()) {
  if (!sessionItem || sessionItem.recurring) return false;
  const day = DAY_INDEX[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const end = toMinutes(sessionItem.endTime);
  if (end === null) return false;
  return day === sessionItem.lectureDay && currentMinutes > end;
}

module.exports = {
  DAY_INDEX,
  toMinutes,
  hasScheduleOverlap,
  isNonRecurringExpired,
};
