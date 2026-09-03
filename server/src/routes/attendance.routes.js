const express = require('express');
const { studentRecordLimiter, helpCodeLimiter } = require('../config/rateLimit');
const { requireStudent } = require('../middlewares/requireAuth');
const attendanceController = require('../controllers/attendance.controller');

const router = express.Router();

/**
 * The 8-digit code is the only guessable secret a student can submit, so it
 * carries a much tighter budget than the GPS/BLE paths. Applied here rather than
 * on the router because all three submission shapes share one endpoint — the
 * body is already parsed by the time this runs.
 */
function limitHelpCode(req, res, next) {
  if (req.body && req.body.code !== undefined) return helpCodeLimiter(req, res, next);
  return next();
}

router.get('/attendance-status', requireStudent, attendanceController.status);
router.get('/bluetooth-target', requireStudent, attendanceController.bluetoothTarget);
router.post(
  '/attendance',
  requireStudent,
  studentRecordLimiter,
  limitHelpCode,
  attendanceController.recordUnified,
);
router.get('/attendance/seed-token', requireStudent, attendanceController.seedToken);
router.delete('/attendance/seed-token', requireStudent, attendanceController.releaseSeedToken);

module.exports = router;
