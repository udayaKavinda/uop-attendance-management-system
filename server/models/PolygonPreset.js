const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({ lat: Number, lng: Number }, { _id: false });

const polygonPresetSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  polygons: { type: [[pointSchema]], default: [] },
}, { timestamps: true });

polygonPresetSchema.index({ name: 1 });

module.exports = mongoose.model('PolygonPreset', polygonPresetSchema);
