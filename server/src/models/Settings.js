const mongoose = require('mongoose');

/**
 * Singleton document (exactly one row, found via findOne({}) — no fixed id needed).
 * Global toggles that apply instantly across every session, unlike per-session config.
 */
const settingsSchema = new mongoose.Schema({
  /**
   * Global Bluetooth kill switch. Off stops lecturer broadcasts, stops student BLE
   * scanning, and disables peer seeding — leaving the GPS geofence as the only
   * automatic path. GPS itself has no kill switch: every session depends on it.
   */
  bleEnabled: { type: Boolean, default: true },

  /**
   * Distance bands, in meters from the nearest active building polygon of the
   * session. `near` is the auto-pass radius; between `near` and `far` a student is
   * suspicious; beyond `far` they are treated as absent unless a lecturer reviews.
   */
  nearBufferM: { type: Number, default: 50, min: 0 },
  farBufferM: { type: Number, default: 100, min: 0 },

  /**
   * What a correct lecturer code does for a student in the suspicious band.
   * true  — passes them outright (fast, trusts the code).
   * false — sends them to lecturer review like the far band (strict).
   * The far/unknown bands always go to review regardless of this switch.
   */
  suspiciousBandAutoPass: { type: Boolean, default: true },

  /** Target concurrent BLE seeder count. 0 disables peer seeding entirely. */
  seedRate: { type: Number, default: 0, min: 0 },
  /** Real seeder AND decoy window duration, ms — identical for both so neither is distinguishable. */
  seedWindowMs: { type: Number, default: 60_000, min: 10_000 },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
