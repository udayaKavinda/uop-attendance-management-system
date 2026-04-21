const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  courseCode: { type: String, required: true },
  lectureCode: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  method: { type: String, enum: ['google'], required: true },
  location: {
    lat: Number,
    lng: Number,
  },
});

module.exports = mongoose.model('Attendance', attendanceSchema);
