const express = require('express');
const healthController = require('../controllers/health.controller');

const router = express.Router();

router.get('/healthz', healthController.healthz);
router.get('/app-version', healthController.appVersion);

module.exports = router;
