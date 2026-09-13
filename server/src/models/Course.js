const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  /**
   * Every batch that takes this course, e.g. ["E21", "E22", "E23"].
   *
   * One course is one row however many batches sit it. The batches share the
   * code, the name, the owners and — the part that matters — the sessions and
   * the attendance matrix, so a row per batch only duplicated all of that and
   * split one lecture's roll across several documents. Kept sorted and
   * de-duplicated by the validator that feeds it.
   */
  batches: {
    type: [{ type: String, trim: true, uppercase: true, match: /^E\d{2}$/ }],
    required: true,
    validate: {
      validator: (v) => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length,
      message: 'batches must list at least one batch, each only once',
    },
  },
  lecturers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Person',
    required: true,
  }],
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

/**
 * A code can be offered again — the same course runs for next year's intake —
 * but no batch may take the same code twice. So the key is each (code, batch)
 * pair rather than the code: a unique multikey index over the batches list
 * refuses a new EE356 that repeats any batch an existing EE356 already has,
 * while EE356 for a wholly new intake is simply another course. MongoDB applies
 * a unique multikey constraint across documents and never within one, which is
 * exactly this rule; the `batches` validator keeps a single course's own list
 * free of repeats.
 */
courseSchema.index({ code: 1, batches: 1 }, { unique: true });
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
