const mongoose = require('mongoose');

/**
 * Live rotating state for a session's manual attendance code. Deliberately its own
 * small collection (not folded into BleToken) — the BLE token's owner/role
 * generalization for peer seeding isn't needed here; this is a single lecturer-
 * controlled value per session, same shape BleToken already has today.
 */
const manualCodeSchema = new mongoose.Schema({
  session: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true },
  /** Grace-window value. Left null after a forced regenerate/resume so the old
   *  code stops working immediately instead of a few seconds later. */
  prevCode: { type: String, default: null },
  generatedAt: { type: Number, required: true },
  /** Freezes rotation without invalidating the current code. */
  paused: { type: Boolean, default: false },
}, { timestamps: true });

// Auto-expire documents 1 hour after last update (safety cleanup, mirrors BleToken).
manualCodeSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('ManualCode', manualCodeSchema);
