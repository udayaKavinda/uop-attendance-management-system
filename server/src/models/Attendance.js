const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LectureSession', required: true, index: true },
  courseCode: { type: String, required: true },
  lectureCode: { type: String, required: true },
  attendanceDate: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now },
  /**
   * The only field the lecturer sees besides presence itself. `flagged` is a
   * `far`/`unknown` verdict — never a queue awaiting a decision, just a record
   * with a `reason` for the attendance-export cell to point out.
   */
  status: {
    type: String,
    enum: ['present', 'flagged'],
    default: 'present',
    required: true,
    index: true,
  },
  /** Server-internal provenance — never exposed in matrices, rosters, or exports. */
  method: { type: String, enum: ['bluetooth', 'gps', 'code_override'], required: true },
  /** Server-internal distance band at the moment of acceptance. Audit only. */
  band: {
    type: String,
    enum: ['inside', 'near', 'suspicious', 'far', 'unknown'],
    default: null,
  },
  /** True when the accepted BLE token came from a peer seeder rather than the lecturer. */
  seedRelayed: { type: Boolean, default: false },
  /** GPS paths only: the centroid + how many surviving fixes produced it, for audit. */
  centroid: {
    lat: { type: Number },
    lng: { type: Number },
    fixCount: { type: Number },
    distanceM: { type: Number },
  },
  /** `flagged` only: human-readable reason shown as the export cell's comment. */
  reason: { type: String, default: null },
});

attendanceSchema.index({ student: 1, session: 1, attendanceDate: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
