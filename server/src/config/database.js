const mongoose = require('mongoose');
const Person = require('../models/Person');
const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const Attendance = require('../models/Attendance');
const BleToken = require('../models/BleToken');
const ManualCode = require('../models/ManualCode');
const Settings = require('../models/Settings');
const Geofence = require('../models/Geofence');
const { mongoUri, isProd } = require('./env');

async function connectDatabase() {
  mongoose.connection.on('disconnected', () => console.error('[mongo] disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[mongo] reconnected'));
  mongoose.connection.on('error', (err) => console.error('[mongo] error', err.message));
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log('MongoDB connected');
}

async function syncAllIndexes() {
  try {
    await LectureSession.syncIndexes();
    await Attendance.syncIndexes();
    await Person.syncIndexes();
    await Course.syncIndexes();
    await BleToken.syncIndexes();
    await ManualCode.syncIndexes();
    await Settings.syncIndexes();
    await Geofence.syncIndexes();
  } catch (e) {
    // A failed sync means queries may run without their expected indexes (full
    // collection scans under load) — surface loudly and refuse to run in prod.
    console.error('[CRITICAL] Index sync failed — queries may run without indexes:', e);
    if (isProd) process.exit(1);
  }
}

async function closeDatabase() {
  await mongoose.connection.close(false);
}

module.exports = {
  connectDatabase,
  syncAllIndexes,
  closeDatabase,
};
