const LectureSession = require('../models/LectureSession');
const { isNonRecurringExpired } = require('./schedule');

async function deactivateExpiredNonRecurringSessions(filter = {}) {
  const candidates = await LectureSession.find({ ...filter, active: true, recurring: false, deleted: false });
  const expiredIds = candidates.filter((s) => isNonRecurringExpired(s)).map((s) => s._id);
  if (expiredIds.length === 0) return;
  await LectureSession.updateMany({ _id: { $in: expiredIds } }, { $set: { active: false } });
  // BLE token rotation is stateless (epoch-based) — no in-memory state to clean up
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
  // Defer first run until after the event loop tick so Mongoose is fully connected
  setImmediate(tick);
  return setInterval(tick, intervalMs);
}

module.exports = {
  deactivateExpiredNonRecurringSessions,
  startNonRecurringExpiryJob,
  isNonRecurringExpired,
};
