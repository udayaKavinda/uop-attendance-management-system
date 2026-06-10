const LectureSession = require('../models/LectureSession');
const { isNonRecurringExpired } = require('../utils/schedule');
const { BROADCAST_STALE_MS } = require('../utils/constants');
const bluetoothCode = require('./bluetoothCode.service');
const { invalidateActiveSessionCache } = require('./session.service');

async function deactivateExpiredNonRecurringSessions(filter = {}) {
  const candidates = await LectureSession.find({ ...filter, active: true, recurring: false, deleted: false });
  const expiredIds = candidates.filter((s) => isNonRecurringExpired(s)).map((s) => s._id);
  if (expiredIds.length === 0) return;
  await LectureSession.updateMany({ _id: { $in: expiredIds } }, { $set: { active: false } });
}

/**
 * Heartbeat sweep: a broadcasting phone polls GET /broadcast every ~5s, which
 * stamps lastBroadcastSeenAt. If the phone dies (battery, kill, BT off with no
 * network) nothing calls broadcast off — so flip stale channels off here.
 * Students are already rejected at read time via isBroadcastLive(); this keeps
 * the persisted flag (and dashboards) honest too.
 */
async function closeStaleBroadcasts(now = Date.now()) {
  const cutoff = new Date(now - BROADCAST_STALE_MS);
  const stale = await LectureSession.find({
    broadcasting: true,
    $or: [{ lastBroadcastSeenAt: null }, { lastBroadcastSeenAt: { $lt: cutoff } }],
  });
  for (const s of stale) {
    s.broadcasting = false;
    s.lastBroadcastSeenAt = null;
    await s.save();
    await bluetoothCode.removeToken(String(s._id));
    invalidateActiveSessionCache(s.course);
  }
}

/**
 * Runs expiry + stale-broadcast sweep periodically, independent of API traffic.
 * @returns {NodeJS.Timeout}
 */
function startNonRecurringExpiryJob() {
  const intervalMs = Math.max(10_000, Number(process.env.SESSION_EXPIRE_JOB_MS) || 60_000);
  const tick = () => {
    deactivateExpiredNonRecurringSessions().catch((err) => {
      console.error('[session-expiry]', err);
    });
    closeStaleBroadcasts().catch((err) => {
      console.error('[broadcast-sweep]', err);
    });
  };
  setImmediate(tick);
  return setInterval(tick, intervalMs);
}

module.exports = {
  deactivateExpiredNonRecurringSessions,
  closeStaleBroadcasts,
  startNonRecurringExpiryJob,
  isNonRecurringExpired,
};
