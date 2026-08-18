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
  updatedAt: { type: Date, default: Date.now },
});

bleTokenSchema.index({ sessionId: 1, owner: 1, role: 1 }, { unique: true });
// Auto-expire documents 1 hour after last update (safety cleanup)
bleTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('BleToken', bleTokenSchema);
