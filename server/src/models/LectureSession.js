const mongoose = require('mongoose');

const lectureSessionSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  lectureDay: {
    type: String,
    enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    required: true,
  },
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true }, // HH:mm
  recurring: { type: Boolean, required: true },
  /** Local YYYY-MM-DD occurrence for one-time sessions; null for weekly sessions. */
  occurrenceDate: {
    type: String,
    default: null,
    required() { return !this.recurring; },
    index: true,
  },
  /**
   * True while a lecturer device is actively broadcasting the rotating BLE token.
   * BLE is one of two always-on verification paths; when it is off (or globally
   * killed) the GPS geofence still runs.
   */
  broadcasting: { type: Boolean, default: false },
  /** Heartbeat: stamped on every broadcast-token poll (~5s); lets the server auto-close dead channels. */
  lastBroadcastSeenAt: { type: Date, default: null },
  /**
   * The lecturer's escalation code. Always available for every session — the
   * lecturer only chooses whether it rotates. The live value lives in the
   * ManualCode collection and only exists inside the schedule window.
   */
  manualCodeRotationMode: { type: String, enum: ['none', 'interval'], required: true },
  manualCodeRotationSeconds: { type: Number, required: true },
  /**
   * Buildings whose polygons define the GPS geofence for this session. Required:
   * every session verifies by GPS, so a session without a polygon could never
   * place a student in the pass bands.
   */
  buildings: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Geofence' }],
    required: true,
    validate: {
      validator: (v) => Array.isArray(v) && v.length >= 1,
      message: 'At least one building is required',
    },
  },
  active: { type: Boolean, default: true, index: true },
  deleted: { type: Boolean, default: false, index: true },
}, { timestamps: true });

lectureSessionSchema.index({ course: 1, lectureDay: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model('LectureSession', lectureSessionSchema);
