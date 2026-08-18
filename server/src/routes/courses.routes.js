const express = require('express');
const { requireAnyAuth } = require('../middlewares/requireAuth');
const coursesController = require('../controllers/courses.controller');

const router = express.Router();

router.get('/courses/running', requireAnyAuth, coursesController.listRunning);

module.exports = router;
