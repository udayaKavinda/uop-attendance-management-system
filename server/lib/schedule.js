const DAY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function hasScheduleOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
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
