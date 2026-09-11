const mongoose = require('mongoose');

/**
 * The last GPS band a student's automatic attempt reached, kept so a later
 * "get help" code submission can be judged against it.
 *
 * It cannot be derived from GpsFixBuffer instead: that buffer only holds the
 * last 90 seconds, and by the time a student reads the failure screen, asks the
 * lecturer and types eight digits, those fixes are gone. The verdict has to
 * outlive them.
 *
 * Durable rather than in-process for the same reason as GpsFixBuffer — a
 * restart between the automatic attempt and the code submission used to turn a
 * student who was demonstrably inside the building into an `unknown`, which is
 * written as `flagged`.
 */
const attemptVerdictSchema = new mongoose.Schema({
  /** Person._id as a string. */
  student: { type: String, required: true },
  /** LectureSession._id as a string. */
  session: { type: String, required: true },
  band: {
    type: String,
    enum: ['inside', 'near', 'suspicious', 'far', 'unknown'],
    required: true,
  },
  /** Null for an `unknown` recorded without any usable fix. */
  centroid: {
    type: {
      _id: false,
      lat: { type: Number },
      lng: { type: Number },
      bestAccuracy: { type: Number },
      fixCount: { type: Number },
    },
    default: null,
  },
  distanceM: { type: Number, default: null },
  /** Epoch ms of the verdict, so freshness does not depend on the TTL monitor. */
  ts: { type: Number, required: true },
}, { timestamps: true });

attemptVerdictSchema.index({ student: 1, session: 1 }, { unique: true });

/**
 * Safety cleanup. `get` still compares `ts` against the TTL itself, because the
 * TTL monitor is periodic and a verdict that has aged out must stop counting at
 * the moment it expires, not whenever MongoDB next sweeps.
 */
attemptVerdictSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 900 });

module.exports = mongoose.model('AttemptVerdict', attemptVerdictSchema);
