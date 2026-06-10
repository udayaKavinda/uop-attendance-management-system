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
  recurring: { type: Boolean, default: true },
  /**
   * True while a lecturer device is actively broadcasting the rotating BLE token.
   * Single switch replacing the old bluetoothEnabled + attendancePaused pair:
   * attendance is open iff broadcasting is true (and the heartbeat is fresh).
   */
  broadcasting: { type: Boolean, default: false },
  /** Heartbeat: stamped on every broadcast-token poll (~5s); lets the server auto-close dead channels. */
  lastBroadcastSeenAt: { type: Date, default: null },
  bluetoothDeviceName: { type: String, default: null },
  active: { type: Boolean, default: true, index: true },
  deleted: { type: Boolean, default: false, index: true },
}, { timestamps: true });

lectureSessionSchema.index({ course: 1, lectureDay: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model('LectureSession', lectureSessionSchema);
