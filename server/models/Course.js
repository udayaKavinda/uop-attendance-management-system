const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true, index: true },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

courseSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
