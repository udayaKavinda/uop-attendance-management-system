const mongoose = require('mongoose');

/**
 * Token pool: one row per session for the lecturer's primary broadcast
 * (`owner: null, role: 'primary'`), plus one row per active peer seeder
 * (`owner: <student>, role: 'seed'`). A submitted BLE token is valid if it
 * matches ANY live row's `token`/`prevToken` for the session — see
 * bluetoothCode.service.verifyToken.
 */
const bleTokenSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
  role: { type: String, enum: ['primary', 'seed'], default: 'primary' },
  token: { type: String, required: true },
  prevToken: { type: String, default: null },
  generatedAt: { type: Number, required: true },
  /** Seed rows only: epoch ms when this seeder's window ends. */
  leaseUntil: { type: Number, default: null },
  /**
   * Seed rows only: which of the session's `seedRate` seeder slots this row
   * occupies (0-based). Exists so the cap can be enforced by a unique index
   * rather than by counting: selecting a seeder used to read the live count and
   * then mint, two separate awaits, so a lecture's worth of students accepted in
   * the same instant all read a count under the cap and all minted. Measured at
   * seedRate 5 with 40 concurrent accepts: 28 seeders, 5.6x the limit — which
   * widens the effective BLE radius the whole "you must be in the room" premise
   * rests on. Claiming a numbered slot makes over-minting impossible: the loser
   * of a race gets a duplicate-key error and moves on to the next slot.
   */
  slot: { type: Number, default: null },
  updatedAt: { type: Date, default: Date.now },
});

bleTokenSchema.index({ sessionId: 1, owner: 1, role: 1 }, { unique: true });
// The cap itself. Partial so the primary row (slot: null) is not covered.
bleTokenSchema.index(
  { sessionId: 1, role: 1, slot: 1 },
  { unique: true, partialFilterExpression: { slot: { $type: 'number' } } },
);
// Auto-expire documents 1 hour after last update (safety cleanup)
bleTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('BleToken', bleTokenSchema);
