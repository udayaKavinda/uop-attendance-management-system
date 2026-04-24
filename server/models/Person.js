const mongoose = require('mongoose');

/** All users (students, admins, lecturers) live in the `people` collection. */
const personSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  /** Google subject or other stable external id; synthetic ids allowed for directory-only lecturers. */
  studentId: { type: String, required: true, unique: true },
  role: { type: String, enum: ['student', 'admin', 'lecturer'], default: 'student' },
  /** Display name (used for lecturers in course UI). */
  name: { type: String, default: '', trim: true },
  phone: { type: String, default: '', trim: true },
  active: { type: Boolean, default: true },
  deleted: { type: Boolean, default: false },
}, { timestamps: true, collection: 'people' });

personSchema.index({ role: 1, deleted: 1 });

module.exports = mongoose.model('Person', personSchema);
