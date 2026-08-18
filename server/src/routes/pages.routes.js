const express = require('express');
const pagesController = require('../controllers/pages.controller');

const router = express.Router();

router.get('/privacy', pagesController.privacy);
router.get('/delete', pagesController.deleteAccount);

module.exports = router;
