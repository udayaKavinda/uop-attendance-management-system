const bluetoothCode = require('./bluetoothCode.service');
const settingsService = require('./settings.service');

/**
 * Server-driven seeder selection, run once a student has been accepted.
 *
 *   if BLE is globally off:                   role = none
 *   else if not accepted via a PRIMARY token: role = none
 *   else if seeding is switched off:          role = none
 *   else if not student.canAdvertise:         role = decoy
 *   else if a seeder slot can be claimed:     role = seeder
 *   else:                                     role = decoy
 *
 * Only primary-BLE-verified students are eligible. A GPS-passed student can sit
 * up to the near buffer away from the building, so re-broadcasting the classroom
 * token from their phone would push it well outside the room and undermine the
 * "BLE proves you are in the room" premise the whole model rests on. A student
 * who heard a seeder rather than the lecturer is excluded for the same reason,
 * one hop further out.
 *
 * Decoys get the identical `durationMs` as real seeders so the two are
 * indistinguishable. That concealment still holds where it matters: among the
 * eligible (primary-verified) students, nobody can tell who was picked. A
 * GPS-passed student getting no window at all reveals nothing they didn't
 * already know — their own device knows it never heard a token.
 */
async function selectSeedingRole(sessionItem, studentId, canAdvertise, bleRole = null) {
  if (bleRole !== 'primary') {
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
