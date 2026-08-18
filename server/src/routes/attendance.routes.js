const express = require('express');
const { studentRecordLimiter } = require('../config/rateLimit');
const { requireStudent } = require('../middlewares/requireAuth');
const attendanceController = require('../controllers/attendance.controller');

const router = express.Router();

router.get('/attendance-status', requireStudent, attendanceController.status);
router.get('/bluetooth-target', requireStudent, attendanceController.bluetoothTarget);
router.post(
  '/attendance',
  requireStudent,
  studentRecordLimiter,
  attendanceController.recordUnified,
);
router.get('/attendance/seed-token', requireStudent, attendanceController.seedToken);
router.delete('/attendance/seed-token', requireStudent, attendanceController.releaseSeedToken);

module.exports = router;
