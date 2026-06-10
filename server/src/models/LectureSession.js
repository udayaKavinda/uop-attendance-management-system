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
  /** When true during a live window, students cannot record attendance (session stays active). */
  attendancePaused: { type: Boolean, default: false },
  bluetoothEnabled: { type: Boolean, default: false },
  bluetoothDeviceName: { type: String, default: null },
  active: { type: Boolean, default: true, index: true },
  deleted: { type: Boolean, default: false, index: true },
}, { timestamps: true });

lectureSessionSchema.index({ course: 1, lectureDay: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model('LectureSession', lectureSessionSchema);
