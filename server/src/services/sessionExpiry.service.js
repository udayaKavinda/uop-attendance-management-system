const LectureSession = require('../models/LectureSession');
const { isNonRecurringExpired } = require('../utils/schedule');
const { BROADCAST_STALE_MS } = require('../utils/constants');
const { isWithinScheduleWindow } = require('./session.service');
const { closeBroadcast } = require('./lectureSession.service');
const manualCode = require('./manualCode.service');
const bluetoothCode = require('./bluetoothCode.service');

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
    await closeBroadcast(s);
  }
}

/** Turns off broadcasts that outlived their scheduled lecture window. */
async function closeOutOfWindowBroadcasts(now = new Date()) {
  const live = await LectureSession.find({ broadcasting: true, deleted: false });
  for (const s of live) {
    if (!isWithinScheduleWindow(s, now)) {
      await closeBroadcast(s);
    }
  }
}

/**
 * Removes manual attendance codes for sessions that have left their scheduled
 * window — same "ending the session invalidates it" rule as the BLE token, and
 * necessary here since manualCodeEnabled is a standing config (not a per-lecture
 * on/off like broadcasting), so a recurring session's code would otherwise sit
 * valid indefinitely between occurrences.
 */
async function closeOutOfWindowManualCodes(now = new Date()) {
  const enabled = await LectureSession.find({ manualCodeEnabled: true, deleted: false });
  for (const s of enabled) {
    if (!isWithinScheduleWindow(s, now)) {
      await manualCode.removeCode(s);
    }
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
    closeOutOfWindowBroadcasts().catch((err) => {
      console.error('[broadcast-window-sweep]', err);
    });
    closeOutOfWindowManualCodes().catch((err) => {
      console.error('[manual-code-window-sweep]', err);
    });
    bluetoothCode.removeExpiredSeedTokens().catch((err) => {
      console.error('[seed-token-sweep]', err);
    });
  };
  setImmediate(tick);
  return setInterval(tick, intervalMs);
}

module.exports = {
  deactivateExpiredNonRecurringSessions,
  closeStaleBroadcasts,
  closeOutOfWindowBroadcasts,
  closeOutOfWindowManualCodes,
  startNonRecurringExpiryJob,
  isNonRecurringExpired,
};
