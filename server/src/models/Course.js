const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  batch: { type: String, required: true, trim: true },
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

// Active courses must always keep at least 1 owner; an archived course may be
// left ownerless (e.g. its last remaining lecturer was deleted) since it runs
// no sessions and takes no attendance.
courseSchema.path('lecturers').validate(function validateLecturers(v) {
  const list = Array.isArray(v) ? v : [];
  if (this.active && list.length === 0) return false;
  const normalized = list.map((id) => String(id));
  return new Set(normalized).size === normalized.length;
}, 'lecturers must include at least 1 unique lecturer id');

module.exports = mongoose.model('Course', courseSchema);
