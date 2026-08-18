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
router.patch('/:sessionId/broadcast', requireStaff, sessionGuard, asyncHandler(sessionsController.setBroadcast));
router.get('/:sessionId/broadcast', requireStaff, sessionGuard, asyncHandler(sessionsController.getBroadcast));
router.get('/:sessionId/attendance', requireStaff, sessionGuard, asyncHandler(sessionsController.sessionAttendance));
router.get('/:sessionId/manual-code', requireStaff, sessionGuard, asyncHandler(sessionsController.getManualCode));
router.patch('/:sessionId/manual-code', requireStaff, sessionGuard, asyncHandler(sessionsController.patchManualCode));

module.exports = router;
