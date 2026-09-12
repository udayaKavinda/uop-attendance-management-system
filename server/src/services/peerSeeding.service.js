const bluetoothCode = require('./bluetoothCode.service');
const settingsService = require('./settings.service');

/**
 * BLE roles that may re-broadcast: anyone whose radio actually heard the room,
 * whether that was the lecturer's own beacon or another student's relay.
 *
 * `seed` is included deliberately, so the mesh extends hop by hop — that
 * outward growth is the point of seeding in a large hall, not a side effect to
 * be contained. Seeding used to be `primary` only, which bounded the chain to a
 * single hop; the range that bought was not worth the rooms it failed to cover.
 *
 * What is NOT in this set matters just as much. A GPS-passed student has
 * `bleRole` null: they can sit up to the near buffer from the building, having
 * heard nothing at all, so re-broadcasting from their phone would put the
 * classroom token somewhere no radio ever reached and break the one thing BLE
 * is trusted for. The set, rather than a `!== 'primary'` test, is what keeps
 * that distinction explicit now that two roles pass it.
 */
const SEEDING_ELIGIBLE_BLE_ROLES = new Set(['primary', 'seed']);

/**
 * Server-driven seeder selection, run once a student has been accepted.
 *
 *   if not accepted via a BLE token:          role = none
 *   else if BLE is globally off:              role = none
 *   else if seeding is switched off:          role = none
 *   else if not student.canAdvertise:         role = decoy
 *   else if a seeder slot can be claimed:     role = seeder
 *   else:                                     role = decoy
 *
 * The chain is unbounded in hops but not in width: `claimSeedSlot` caps live
 * seeders at `Settings.seedRate` for the whole session, so a further hop changes
 * *who* holds a slot, never how many exist. Note what that does and does not
 * bound — the count is fixed, the reach is not, because each expiring lease can
 * be claimed by someone further out than the last holder. Seeding is off by
 * default (`seedRate: 0`); an admin turning it on is choosing that trade.
 *
 * Decoys get the identical `durationMs` as real seeders so the two are
 * indistinguishable. That concealment still holds where it matters: among the
 * eligible (BLE-verified) students, nobody can tell who was picked. A
 * GPS-passed student getting no window at all reveals nothing they didn't
 * already know — their own device knows it never heard a token.
 */
async function selectSeedingRole(sessionItem, studentId, canAdvertise, bleRole = null) {
  if (!SEEDING_ELIGIBLE_BLE_ROLES.has(bleRole)) {
    return { role: 'none' };
  }

  const settings = await settingsService.getSettings();
  if (settings.bleEnabled === false) {
    return { role: 'none' };
  }

  const seedRate = settings.seedRate || 0;
  // Seeding switched off entirely: no one is ever a real seeder, so there is
  // nothing to conceal — show no window at all rather than a decoy with no purpose.
  if (seedRate <= 0) {
    return { role: 'none' };
  }

  const durationMs = settings.seedWindowMs;
  if (!canAdvertise) {
    return { role: 'decoy', durationMs };
  }

  // One atomic step, not a count followed by a mint: the two-step version let a
  // whole lecture's worth of simultaneous accepts each read a count below the cap
  // and each mint, blowing past seedRate by several times over. claimSeedSlot
  // returns null when every slot is genuinely taken, which is the decoy case.
  const leaseUntil = Date.now() + durationMs;
  const claim = await bluetoothCode.claimSeedSlot(
    String(sessionItem._id), String(studentId), leaseUntil, seedRate,
  );
  if (!claim) {
    return { role: 'decoy', durationMs };
  }

  const { token } = claim;
  return {
    // sessionId lets the client re-fetch its rotating seeder token via
    // GET /api/attendance/seed-token?sessionId= without needing it from elsewhere.
    role: 'seed', sessionId: String(sessionItem._id), token, durationMs,
  };
}

module.exports = { selectSeedingRole };
