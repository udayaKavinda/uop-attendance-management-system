const express = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const {
  requireStaff,
  requireAdmin,
  requireCourseAccess,
} = require('../../middlewares/requireAuth');
const coursesController = require('../../controllers/admin/courses.controller');

const router = express.Router();

router.get('/', requireStaff, asyncHandler(coursesController.list));
router.post('/', requireStaff, asyncHandler(coursesController.create));
router.patch('/:courseId/assign-lecturer', requireAdmin, asyncHandler(coursesController.assignLecturer));
router.delete('/:courseId', requireStaff, requireCourseAccess(), asyncHandler(coursesController.remove));
router.patch('/:courseId/disable', requireStaff, requireCourseAccess(), asyncHandler(coursesController.disable));
router.patch('/:courseId/enable', requireStaff, requireCourseAccess(), asyncHandler(coursesController.enable));
router.get('/:courseId/sessions', requireStaff, requireCourseAccess(), asyncHandler(coursesController.listSessions));
router.post('/:courseId/sessions', requireStaff, requireCourseAccess(), asyncHandler(coursesController.createSession));
router.get('/:courseId/attendance-matrix', requireStaff, requireCourseAccess(), asyncHandler(coursesController.attendanceMatrix));

module.exports = router;
