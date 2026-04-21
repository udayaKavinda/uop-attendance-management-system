const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
}, { _id: false });

const courseConfigSchema = new mongoose.Schema({
  courseCode: { type: String, required: true, unique: true, index: true },
  lectureDay: {
    type: String,
    enum: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    default: 'MON',
    required: true,
  },
  startTime: { type: String, default: '08:00', required: true }, // HH:mm
  endTime: { type: String, default: '10:00', required: true }, // HH:mm
  recurring: { type: Boolean, default: true },
  polygon: { type: [pointSchema], default: [] }, // simple polygon points
}, { timestamps: true });

module.exports = mongoose.model('CourseConfig', courseConfigSchema);
