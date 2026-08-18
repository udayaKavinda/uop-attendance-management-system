const bluetoothCode = require('./bluetoothCode.service');
const settingsService = require('./settings.service');

/**
 * Server-driven seeder selection, run once a student is validated (BLE or GPS).
 * Mirrors the design doc's pseudocode exactly:
 *
 *   if session.mode == geofence-only:        role = none
 *   else if not student.canAdvertise:        role = decoy
 *   else if liveSeederCount(session) < seedRate:  role = seeder; mint
 *   else:                                     role = decoy
 *
 * Decoys get the identical `durationMs` as real seeders (decision 3) so the two
 * are indistinguishable to the student; `role: 'none'` (geofence-only sessions,
 * decision 4) means no seeding UI should appear at all.
 */
async function selectSeedingRole(sessionItem, studentId, canAdvertise) {
  if (sessionItem.verification === 'geofence') {
    return { role: 'none' };
  }

  const settings = await settingsService.getSettings();
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

  const liveCount = await bluetoothCode.countLiveSeeders(String(sessionItem._id));
  if (liveCount >= seedRate) {
    return { role: 'decoy', durationMs };
  }

  const leaseUntil = Date.now() + durationMs;
  const { token } = await bluetoothCode.mintSeedToken(String(sessionItem._id), String(studentId), leaseUntil);
  return {
    // sessionId lets the client re-fetch its rotating seeder token via
    // GET /api/attendance/seed-token?sessionId= without needing it from elsewhere.
    role: 'seed', sessionId: String(sessionItem._id), token, durationMs,
  };
}

module.exports = { selectSeedingRole };
