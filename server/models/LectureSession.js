const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
}, { _id: false });

const lectureSessionSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  name: { type: String, default: '', trim: true },
  lectureDay: {
    type: String,
    enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    required: true,
  },
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true }, // HH:mm
  recurring: { type: Boolean, default: true },
  rotationEnabled: { type: Boolean, default: false },
  rotationPaused: { type: Boolean, default: false },
  rotationOccurrenceKey: { type: String, default: '' },
  polygons: { type: [[pointSchema]], default: [] },
  active: { type: Boolean, default: true, index: true },
  deleted: { type: Boolean, default: false, index: true },
}, { timestamps: true });

lectureSessionSchema.index({ course: 1, lectureDay: 1, startTime: 1, endTime: 1 });

module.exports = mongoose.model('LectureSession', lectureSessionSchema);
