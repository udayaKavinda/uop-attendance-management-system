const LectureSession = require('../models/LectureSession');
const lectureCode = require('./lectureCode');

const DAY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function sessionCodeKey(sessionId) {
  return `session:${sessionId}`;
}

function isNonRecurringExpired(sessionItem, now = new Date()) {
  if (!sessionItem || sessionItem.recurring) return false;
  const day = DAY_INDEX[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const end = toMinutes(sessionItem.endTime);
  if (end === null) return false;
  return day === sessionItem.lectureDay && currentMinutes > end;
}

async function deactivateExpiredNonRecurringSessions(filter = {}) {
  const candidates = await LectureSession.find({ ...filter, active: true, recurring: false, deleted: false });
  const expiredIds = candidates.filter((s) => isNonRecurringExpired(s)).map((s) => s._id);
  if (expiredIds.length === 0) return;
  await LectureSession.updateMany({ _id: { $in: expiredIds } }, { $set: { active: false } });
  expiredIds.forEach((id) => lectureCode.removeKey(sessionCodeKey(id)));
}

/**
 * Runs expiry periodically so non-recurring sessions are deactivated without relying on API traffic.
 * @returns {NodeJS.Timeout}
 */
function startNonRecurringExpiryJob() {
  const intervalMs = Math.max(10_000, Number(process.env.SESSION_EXPIRE_JOB_MS) || 60_000);
  const tick = () => {
    deactivateExpiredNonRecurringSessions().catch((err) => {
      console.error('[session-expiry]', err);
    });
  };
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = {
  deactivateExpiredNonRecurringSessions,
  startNonRecurringExpiryJob,
};
