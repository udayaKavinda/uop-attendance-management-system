const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const { studentRecordLimiter } = require('../config/rateLimit');
const { requireStudent } = require('../middlewares/requireAuth');
const attendanceController = require('../controllers/attendance.controller');

const router = express.Router();

router.get('/attendance-status', requireStudent, asyncHandler(attendanceController.status));
router.post(
  '/manual-attendance',
  requireStudent,
  studentRecordLimiter,
  asyncHandler(attendanceController.recordManualCode),
);

// Unified endpoint (BLE token / GPS fix / manual code, one at a time) — the
// current app targets this; the endpoints above remain for already-installed
// older versions.
router.post(
  '/attendance',
  requireStudent,
  studentRecordLimiter,
  asyncHandler(attendanceController.recordUnified),
);
router.get('/attendance/seed-token', requireStudent, asyncHandler(attendanceController.seedToken));
router.delete('/attendance/seed-token', requireStudent, asyncHandler(attendanceController.releaseSeedToken));

module.exports = router;
