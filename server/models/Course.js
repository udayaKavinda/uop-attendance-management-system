const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  batch: { type: String, required: true, trim: true, default: '' },
  lecturer: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

courseSchema.index({ code: 1, batch: 1 }, { unique: true });
courseSchema.index({ code: 1 });

module.exports = mongoose.model('Course', courseSchema);
