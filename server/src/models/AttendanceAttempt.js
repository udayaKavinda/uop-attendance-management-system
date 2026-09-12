const mongoose = require('mongoose');

/**
 * Everything one attendance attempt accumulates: the GPS fixes streamed for it,
 * and the band those fixes last resolved to.
 *
 * These were two collections, and before that two per-process Maps. They are one
 * document because they are one thing: the same (student, session) key, written
 * in the same request, and cleared together at every call site. Splitting them
 * was inherited from the two Maps being two variables, which is not a reason.
 *
 * The two halves keep different *lifetimes*, and that is the subtle part. Fixes
 * matter for 90 seconds. The verdict has to outlive them by minutes, because the
 * student reads the failure screen, finds the lecturer and types eight digits
 * long after their fixes aged out — so nothing may delete this document merely
 * because its fixes went stale. `verdictTs` is what expiry is measured against,
 * and fix ageing is applied in code against each fix's own `ts`.
 *
 * A document can legitimately hold either half alone: fixes with no band yet
 * (fewer than the three-fix minimum), or a band with no fixes (the fail-closed
 * `unknown` recorded when a session's buildings have all been deleted).
 */
const attendanceAttemptSchema = new mongoose.Schema({
  /** Person._id as a string — the key the attendance service already works in. */
  student: { type: String, required: true },
  /** LectureSession._id as a string. */
  session: { type: String, required: true },

  /**
   * Capped by `$slice` on write so a chatty or misbehaving client cannot grow
   * one document without bound. The 90-second window is applied on read, since
   * that is what decides the verdict.
   */
  fixes: {
    type: [{
      _id: false,
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      /** Raw device value; 0/absent means "unmeasured" and is normalised on read. */
      accuracy: { type: Number, default: 0 },
      /** Epoch ms, stamped by the server so a wrong device clock cannot widen the window. */
      ts: { type: Number, required: true },
    }],
    default: [],
  },

  /** Null until the fixes first resolve to a band. */
  band: {
    type: String,
    enum: ['inside', 'near', 'suspicious', 'far', 'unknown', null],
    default: null,
  },
  centroid: {
    type: {
      _id: false,
      lat: { type: Number },
      lng: { type: Number },
      fixCount: { type: Number },
    },
    default: null,
  },
  distanceM: { type: Number, default: null },
  /** Epoch ms the band was recorded; null while there is no verdict. */
  verdictTs: { type: Number, default: null },
}, { timestamps: true });

attendanceAttemptSchema.index({ student: 1, session: 1 }, { unique: true });

/**
 * Safety cleanup, sized to the longer of the two lifetimes — the verdict's.
 * Using the fix window here instead would delete attempts out from under
 * students who are still walking to the front of the hall for the code.
 */
attendanceAttemptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 900 });

module.exports = mongoose.model('AttendanceAttempt', attendanceAttemptSchema);
