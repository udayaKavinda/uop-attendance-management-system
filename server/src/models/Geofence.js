const mongoose = require('mongoose');

/** Named building polygon an admin draws on the Android OpenStreetMap tool. */
const geofenceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  /** Ordered [lng, lat] vertices — GeoJSON coordinate order, closed or open (the
   *  point-in-polygon check treats it as implicitly closed either way). */
  polygon: {
    type: [[Number]],
    required: true,
    validate: {
      validator: (v) => Array.isArray(v) && v.length >= 3 && v.every(
        (pt) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite),
      ),
      message: 'polygon must have at least 3 [lng, lat] vertices',
    },
  },
  active: { type: Boolean, default: true },
  deleted: { type: Boolean, default: false },
  // Deliberately unindexed. Every query here filters on `active`/`deleted`, but
  // buildings are drawn by hand and number in the tens — at that size a scan
  // beats an index lookup plus fetch, and two booleans make poor index keys
  // anyway. They would still be maintained on every write.
}, { timestamps: true });

module.exports = mongoose.model('Geofence', geofenceSchema);
