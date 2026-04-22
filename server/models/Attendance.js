const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LectureSession', required: true, index: true },
  courseCode: { type: String, required: true },
  lectureCode: { type: String, required: true },
  attendanceDate: { type: String, required: true, index: true }, // YYYY-MM-DD
  timestamp: { type: Date, default: Date.now },
  method: { type: String, enum: ['google'], required: true },
  location: {
    lat: Number,
    lng: Number,
  },
});

attendanceSchema.index({ student: 1, session: 1, attendanceDate: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
