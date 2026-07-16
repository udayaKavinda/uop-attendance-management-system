const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const pagesController = require('../controllers/pages.controller');

const router = express.Router();

router.get('/privacy', asyncHandler(pagesController.privacy));
router.get('/delete', asyncHandler(pagesController.deleteAccount));

module.exports = router;
