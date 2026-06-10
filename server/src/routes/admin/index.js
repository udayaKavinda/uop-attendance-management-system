const express = require('express');
const coursesRoutes = require('./courses.routes');
const sessionsRoutes = require('./sessions.routes');
const lecturersRoutes = require('./lecturers.routes');

const router = express.Router();

router.use('/courses', coursesRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/lecturers', lecturersRoutes);

module.exports = router;
