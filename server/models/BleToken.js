const mongoose = require('mongoose');

const bleTokenSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  token: { type: String, required: true },
  prevToken: { type: String, default: null },
  generatedAt: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
});

// Auto-expire documents 1 hour after last update (safety cleanup)
bleTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('BleToken', bleTokenSchema);
