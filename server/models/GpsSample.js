const mongoose = require('mongoose');

/**
 * Stores every raw GPS sample collected from a student during the 2-minute
 * collection window. One document per GPS reading — not aggregated.
 * Used by the Attendance GPS Analysis admin dashboard for post-hoc geofence analysis.
 */
const gpsSampleSchema = new mongoose.Schema({
  session:  { type: mongoose.Schema.Types.ObjectId, ref: 'LectureSession', required: true, index: true },
  course:   { type: mongoose.Schema.Types.ObjectId, ref: 'Course',         required: true, index: true },
  student:  { type: mongoose.Schema.Types.ObjectId, ref: 'Person',         required: true, index: true },

  lat:      { type: Number, required: true },
  lng:      { type: Number, required: true },
  accuracy: { type: Number, default: null },

  /** Client-reported timestamp of the GPS reading (device time). */
  clientTimestamp: { type: Date, default: null },
  /** Server-side insert time. */
  timestamp: { type: Date, default: Date.now, index: true },

  /**
   * Whether this sample is within 100 m of the session geofence.
   * null = session had no polygons (treated as valid for attendance).
   * true = inside polygon or ≤100 m from the nearest edge.
   * false = >100 m from the nearest edge.
   */
  nearGeofence: { type: Boolean, default: null },

  /**
   * Computed distance in metres from the nearest polygon edge.
   * 0 when the point is inside the polygon.
   * null when the session has no polygons.
   */
  distanceM: { type: Number, default: null },

  device: {
    type:      { type: String, default: '' },
    os:        { type: String, default: '' },
    browser:   { type: String, default: '' },
    userAgent: { type: String, default: '' },
    model:     { type: String, default: '' },
  },
});

/** Compound index for fetching all samples for a session, grouped by student. */
gpsSampleSchema.index({ session: 1, student: 1, timestamp: 1 });

module.exports = mongoose.model('GpsSample', gpsSampleSchema);
