const mongoose = require('mongoose');

/**
 * Singleton document (exactly one row, found via findOne({}) — no fixed id needed).
 * Global toggles that apply instantly across every session, unlike per-session config.
 */
const settingsSchema = new mongoose.Schema({
  /** Global kill-switch for manual attendance codes. Off hides/rejects the feature
   *  everywhere immediately, regardless of any session's own manualCodeEnabled. */
  manualCodeAllowed: { type: Boolean, default: true },

  /**
   * Constrains which `verification` values a session may pick (see
   * LectureSession.verification). Applies to NEW sessions only — an in-flight
   * broadcast/geofence session is never stranded by a policy change.
   */
  allowedModes: { type: String, enum: ['bluetooth', 'geofence', 'both'], default: 'bluetooth' },

  /** Target concurrent BLE seeder count. 0 disables peer seeding entirely. */
  seedRate: { type: Number, default: 0, min: 0 },
  /** Real seeder AND decoy window duration, ms — identical for both so neither is distinguishable. */
  seedWindowMs: { type: Number, default: 60_000, min: 10_000 },

  /** GPS buffer (meters) for geofence-only sessions — the loosest tier, GPS is the only signal. */
  bufferGpsOnly: { type: Number, default: 30, min: 0 },
  /** GPS buffer (meters) for the GPS fallback path within `both` sessions — tighter, since BLE already proves proximity. */
  bufferGpsBle: { type: Number, default: 15, min: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
