const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const { requireAnyAuth } = require('../middlewares/requireAuth');
const coursesController = require('../controllers/courses.controller');

const router = express.Router();

router.get('/courses', requireAnyAuth, asyncHandler(coursesController.list));
router.get('/courses/running', requireAnyAuth, asyncHandler(coursesController.listRunning));

module.exports = router;
