const express = require('express');
const coursesRoutes = require('./courses.routes');
const sessionsRoutes = require('./sessions.routes');
const lecturersRoutes = require('./lecturers.routes');
const settingsRoutes = require('./settings.routes');
const geofencesRoutes = require('./geofences.routes');

const router = express.Router();

router.use('/courses', coursesRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/lecturers', lecturersRoutes);
router.use('/settings', settingsRoutes);
router.use('/geofences', geofencesRoutes);

module.exports = router;
