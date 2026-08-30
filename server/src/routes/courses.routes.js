const express = require('express');
const { requireAnyAuth, requireStudent } = require('../middlewares/requireAuth');
const coursesController = require('../controllers/courses.controller');

const router = express.Router();

router.get('/courses/running', requireAnyAuth, coursesController.listRunning);

// Course registration is student-only: it exists to help a student find their
// own lecture faster, not something staff accounts have a use for.
router.get('/courses/catalog', requireStudent, coursesController.listCatalog);
router.get('/courses/registered', requireStudent, coursesController.listRegistered);
router.post('/courses/registered/:courseId', requireStudent, coursesController.registerCourse);
router.delete('/courses/registered/:courseId', requireStudent, coursesController.unregisterCourse);

module.exports = router;
