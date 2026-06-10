const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const { studentRecordLimiter } = require('../config/rateLimit');
const { requireStudent } = require('../middlewares/requireAuth');
const bluetoothController = require('../controllers/bluetooth.controller');

const router = express.Router();

router.get('/bluetooth-target', requireStudent, asyncHandler(bluetoothController.target));
router.post('/bluetooth-attendance', requireStudent, studentRecordLimiter, asyncHandler(bluetoothController.recordAttendance));

module.exports = router;
