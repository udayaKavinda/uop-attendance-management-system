const mongoose = require('mongoose');

/**
 * The GPS fixes a student's device has streamed for one attempt, held until the
 * attempt resolves.
 *
 * This used to be a per-process `Map`, which had two consequences that only look
 * small until a lecture is running. A server restart mid-window discarded every
 * buffer, so students who were part-way through an attempt silently banded
 * `unknown` and were flagged despite standing in the room. And because the state
 * lived in one process's heap, the app could never run more than one instance:
 * a second worker would see an empty buffer for a student the first worker was
 * already accumulating, and neither would reach the 3-fix minimum.
 *
 * `fixes` is capped by `$slice` on write so a chatty or misbehaving client
 * cannot grow one document without bound; the 90-second window is still applied
 * in code on read, because that is what decides the verdict.
 */
const gpsFixBufferSchema = new mongoose.Schema({
  /** Person._id as a string — the key the attendance service already works in. */
  student: { type: String, required: true },
  /** LectureSession._id as a string. */
  session: { type: String, required: true },
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
}, { timestamps: true });

gpsFixBufferSchema.index({ student: 1, session: 1 }, { unique: true });

/**
 * Safety cleanup only. Deliberately far longer than the 90-second window: the
 * TTL monitor runs about once a minute, so a value near the window would race
 * the attempt it belongs to, and expiry is not what makes a stale fix
 * ineligible — the explicit age filter on read is.
 */
gpsFixBufferSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 300 });

module.exports = mongoose.model('GpsFixBuffer', gpsFixBufferSchema);
