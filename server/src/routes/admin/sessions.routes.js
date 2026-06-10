const express = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const {
  requireStaff,
  requireSessionAccess,
} = require('../../middlewares/requireAuth');
const sessionsController = require('../../controllers/admin/sessions.controller');

const router = express.Router();
const sessionGuard = requireSessionAccess();
const sessionWithCourse = requireSessionAccess({ populateCourse: true });

router.get('/', requireStaff, asyncHandler(sessionsController.list));
router.get('/running', requireStaff, asyncHandler(sessionsController.listRunning));
router.delete('/:sessionId', requireStaff, sessionGuard, asyncHandler(sessionsController.remove));
router.patch('/:sessionId/activate', requireStaff, sessionWithCourse, asyncHandler(sessionsController.activate));
router.patch('/:sessionId/deactivate', requireStaff, sessionGuard, asyncHandler(sessionsController.deactivate));
router.patch('/:sessionId/bluetooth/start', requireStaff, sessionGuard, asyncHandler(sessionsController.startBluetooth));
router.patch('/:sessionId/bluetooth/stop', requireStaff, sessionGuard, asyncHandler(sessionsController.stopBluetooth));
router.get('/:sessionId/bluetooth-broadcast', requireStaff, sessionGuard, asyncHandler(sessionsController.bluetoothBroadcast));
router.patch('/:sessionId/attendance-paused', requireStaff, sessionGuard, asyncHandler(sessionsController.setAttendancePaused));
router.get('/:sessionId/attendance', requireStaff, sessionGuard, asyncHandler(sessionsController.sessionAttendance));

module.exports = router;
