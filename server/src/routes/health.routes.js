const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const healthController = require('../controllers/health.controller');

const router = express.Router();

router.get('/healthz', asyncHandler(healthController.healthz));

module.exports = router;
