const express = require('express');
const {
  requireStaff,
  requireSessionAccess,
} = require('../../middlewares/requireAuth');
const sessionsController = require('../../controllers/admin/sessions.controller');

const router = express.Router();
const sessionGuard = requireSessionAccess();
const sessionWithCourse = requireSessionAccess({ populateCourse: true });

router.get('/', requireStaff, sessionsController.list);
router.get('/running', requireStaff, sessionsController.listRunning);
router.delete('/:sessionId', requireStaff, sessionGuard, sessionsController.remove);
router.patch('/:sessionId/activate', requireStaff, sessionWithCourse, sessionsController.activate);
router.patch('/:sessionId/deactivate', requireStaff, sessionGuard, sessionsController.deactivate);
router.patch('/:sessionId/broadcast', requireStaff, sessionGuard, sessionsController.setBroadcast);
router.get('/:sessionId/broadcast', requireStaff, sessionGuard, sessionsController.getBroadcast);
router.get('/:sessionId/manual-code', requireStaff, sessionGuard, sessionsController.getManualCode);
router.patch('/:sessionId/manual-code', requireStaff, sessionGuard, sessionsController.patchManualCode);
router.get('/:sessionId/reviews', requireStaff, sessionGuard, sessionsController.listPendingReviews);
// Nested under the session so the existing access guard covers the record too —
// a lecturer cannot review a submission from someone else's session by id.
router.patch('/:sessionId/reviews/:attendanceId', requireStaff, sessionGuard, sessionsController.reviewSubmission);

module.exports = router;
