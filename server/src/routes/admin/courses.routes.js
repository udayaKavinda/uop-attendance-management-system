const express = require('express');
const {
  requireStaff,
  requireAdmin,
  requireCourseAccess,
} = require('../../middlewares/requireAuth');
const coursesController = require('../../controllers/admin/courses.controller');

const router = express.Router();

router.get('/', requireStaff, coursesController.list);
router.post('/', requireStaff, coursesController.create);
router.patch('/:courseId/assign-lecturer', requireAdmin, coursesController.assignLecturer);
router.delete('/:courseId', requireStaff, requireCourseAccess(), coursesController.remove);
router.patch('/:courseId/disable', requireStaff, requireCourseAccess(), coursesController.disable);
router.patch('/:courseId/enable', requireStaff, requireCourseAccess(), coursesController.enable);
router.post('/:courseId/sessions', requireStaff, requireCourseAccess(), coursesController.createSession);
router.get('/:courseId/attendance-matrix', requireStaff, requireCourseAccess(), coursesController.attendanceMatrix);

module.exports = router;
