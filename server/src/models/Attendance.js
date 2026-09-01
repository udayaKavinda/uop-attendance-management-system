const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LectureSession', required: true },
  courseCode: { type: String, required: true },
  lectureCode: { type: String, required: true },
  attendanceDate: { type: String, required: true },
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
/**
 * The live "students marked" counter polls {session, attendanceDate} every ~5s for the
 * whole lecture, and it was the worst query in the system: with no compound to serve
 * it, the planner fell back to a single-field index and read the session's entire
 * accumulated history to return one day of it. Measured on 1.28M rows (4 semesters):
 * 21,316 documents examined to return 117 — a 182x over-read — which this index takes
 * to 117 examined for 117 returned, 29ms down to 3ms.
 *
 * The over-read grew with the collection, so it was worst exactly when the system is
 * busiest: late in a semester, mid-lecture. `session` as the prefix here also replaces
 * the standalone index that field used to carry.
 *
 * `attendanceDate` and `status` deliberately carry no index of their own: neither is
 * ever a leading query filter (dates are only read alongside a student or session, and
 * status is written but never filtered on), and an index earning nothing still costs
 * write throughput on every check-in plus ~5s of index build on every deploy.
 */
attendanceSchema.index({ session: 1, attendanceDate: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
