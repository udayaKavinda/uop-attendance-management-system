const express = require('express');
const {
  requireStaff,
  requireCourseAccess,
} = require('../../middlewares/requireAuth');
const coursesController = require('../../controllers/admin/courses.controller');

const router = express.Router();

router.get('/', requireStaff, coursesController.list);
router.post('/', requireStaff, coursesController.create);
// Owner or admin — wholesale add/remove, same as the admin UI's Owners dialog.
router.patch('/:courseId/assign-lecturer', requireStaff, requireCourseAccess(), coursesController.assignLecturer);
router.patch('/:courseId/disable', requireStaff, requireCourseAccess(), coursesController.disable);
router.patch('/:courseId/enable', requireStaff, requireCourseAccess(), coursesController.enable);
router.post('/:courseId/sessions', requireStaff, requireCourseAccess(), coursesController.createSession);
router.get('/:courseId/attendance-matrix', requireStaff, requireCourseAccess(), coursesController.attendanceMatrix);
router.get(
  '/:courseId/attendance-matrix.xlsx',
  requireStaff,
  requireCourseAccess(),
  coursesController.attendanceMatrixXlsx,
);

module.exports = router;
