const LectureSession = require('../models/LectureSession');
const { isNonRecurringExpired } = require('../utils/schedule');
const { BROADCAST_STALE_MS } = require('../utils/constants');
const { isWithinScheduleWindow, invalidateActiveSessionCache } = require('./session.service');
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
 * Recurring sessions have no expiry date, so nothing else ever clears `active` once
 * a lecturer collects — a "Collecting" session would otherwise stay collecting
 * forever, then immediately reappear as "Collecting" the instant next week's window
 * opens with no one having tapped Collect. Resets it here once today's window
 * closes, so every occurrence needs its own explicit Collect tap, matching how
 * one-time sessions already go inactive via expiry.
 */
async function deactivateRecurringSessionsPastWindow(now = new Date()) {
  const candidates = await LectureSession.find({ active: true, recurring: true, deleted: false });
  const pastWindowIds = candidates.filter((s) => !isWithinScheduleWindow(s, now)).map((s) => s._id);
  if (pastWindowIds.length === 0) return;
  await LectureSession.updateMany({ _id: { $in: pastWindowIds } }, { $set: { active: false } });
  invalidateActiveSessionCache();
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
    deleted: false,
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
 * Removes lecturer codes for sessions that have left their scheduled window —
 * same "ending the session invalidates it" rule as the BLE token. Necessary
 * because the code is standing config for every session (not a per-lecture on/off
 * like broadcasting), so a recurring session's code would otherwise sit valid
 * indefinitely between occurrences.
 *
 * Driven off the sessions that actually hold a code (typically the handful running
 * today), not off every session in the database: the previous version loaded every
 * non-deleted session each tick and issued a delete for each out-of-window one —
 * i.e. nearly all of them, once a minute, forever.
 */
async function closeOutOfWindowManualCodes(now = new Date()) {
  const sessionIds = await manualCode.sessionIdsWithCode();
  if (sessionIds.length === 0) return;
  const sessions = await LectureSession.find({ _id: { $in: sessionIds } });
  for (const s of sessions) {
    if (!isWithinScheduleWindow(s, now)) {
      await manualCode.removeCode(s);
    }
  }
  // A code whose session row is gone entirely (hard-deleted out of band) would
  // never match above, so drop those by id too rather than leaking them.
  const found = new Set(sessions.map((s) => String(s._id)));
  for (const id of sessionIds) {
    if (!found.has(String(id))) await manualCode.removeCode({ _id: id });
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
    deactivateRecurringSessionsPastWindow().catch((err) => {
      console.error('[recurring-session-window-sweep]', err);
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
  deactivateRecurringSessionsPastWindow,
  closeStaleBroadcasts,
  closeOutOfWindowBroadcasts,
  closeOutOfWindowManualCodes,
  startNonRecurringExpiryJob,
  isNonRecurringExpired,
};
