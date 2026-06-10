const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  batch: { type: String, required: true, trim: true, default: '' },
  lecturers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Person',
    required: true,
  }],
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

courseSchema.index({ code: 1, batch: 1 }, { unique: true });
courseSchema.index({ code: 1 });
courseSchema.index({ lecturers: 1 });

courseSchema.path('lecturers').validate(function validateLecturers(v) {
  const list = Array.isArray(v) ? v : [];
  if (list.length === 0 || list.length > 5) return false;
  const normalized = list.map((id) => String(id));
  return new Set(normalized).size === normalized.length;
}, 'lecturers must include 1 to 5 unique lecturer ids');

module.exports = mongoose.model('Course', courseSchema);
