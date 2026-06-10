const Person = require('../models/Person');
const LectureSession = require('../models/LectureSession');
const { BOOTSTRAP_ADMIN_EMAIL } = require('../utils/constants');

async function ensureBootstrapAdmin() {
  const email = String(BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;
  let person = await Person.findOne({ email });
  if (!person) {
    person = await Person.create({
      email,
      studentId: `bootstrap:${email}`,
      role: 'admin',
      active: true,
      deleted: false,
    });
    console.log(`Bootstrap admin created: ${email}`);
    return;
  }
  let changed = false;
  if (person.role !== 'admin') {
    person.role = 'admin';
    changed = true;
  }
  if (person.deleted) {
    person.deleted = false;
    changed = true;
  }
  if (!person.active) {
    person.active = true;
    changed = true;
  }
  if (changed) {
    await person.save();
    console.log(`Bootstrap admin updated: ${email}`);
  }
}

/**
 * One-time, idempotent migration: collapse the legacy bluetoothEnabled +
 * attendancePaused pair into the single `broadcasting` flag
 * (ON ⇔ bluetoothEnabled && !attendancePaused; every other combination is OFF).
 */
async function migrateLegacyBroadcastFields() {
  const result = await LectureSession.collection.updateMany(
    { bluetoothEnabled: { $exists: true } },
    [
      {
        $set: {
          broadcasting: { $and: [{ $eq: ['$bluetoothEnabled', true] }, { $ne: ['$attendancePaused', true] }] },
          lastBroadcastSeenAt: null,
        },
      },
      { $unset: ['bluetoothEnabled', 'attendancePaused'] },
    ],
  );
  if (result.modifiedCount > 0) {
    console.log(`Migrated ${result.modifiedCount} session(s) to the broadcasting flag`);
  }
}

module.exports = { ensureBootstrapAdmin, migrateLegacyBroadcastFields };
