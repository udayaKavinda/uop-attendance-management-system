const express = require('express');
const healthController = require('../controllers/health.controller');

const router = express.Router();

router.get('/healthz', healthController.healthz);

module.exports = router;
