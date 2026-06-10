const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const { requireStudent } = require('../middlewares/requireAuth');
const attendanceController = require('../controllers/attendance.controller');

const router = express.Router();

router.get('/attendance-status', requireStudent, asyncHandler(attendanceController.status));

module.exports = router;
