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
   * Attendance is open iff this is true and the heartbeat is fresh.
   */
  broadcasting: { type: Boolean, default: false },
  /** Heartbeat: stamped on every broadcast-token poll (~5s); lets the server auto-close dead channels. */
  lastBroadcastSeenAt: { type: Date, default: null },
  /**
   * Lecturer-controlled fallback, independent of Bluetooth. `manualCodeEnabled`
   * is the config; the live rotating code itself lives in the ManualCode
   * collection (see services/manualCode.service.js) and only exists while this
   * is true and the session is inside its schedule window.
   */
  manualCodeEnabled: { type: Boolean, required: true },
  manualCodeRotationMode: { type: String, enum: ['none', 'interval'], required: true },
  manualCodeRotationSeconds: { type: Number, required: true },
  /**
   * Primary verification path for this session, constrained at create/update time
   * by Settings.allowedModes (see settings.service.isVerificationAllowed).
   * `geofence`/`both` require at least one entry in `buildings`.
   */
  verification: { type: String, enum: ['bluetooth', 'geofence', 'both'], required: true },
  buildings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Geofence' }],
  active: { type: Boolean, default: true, index: true },
  deleted: { type: Boolean, default: false, index: true },
}, { timestamps: true });

lectureSessionSchema.index({ course: 1, lectureDay: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model('LectureSession', lectureSessionSchema);
