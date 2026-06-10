const express = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { requireAdmin } = require('../../middlewares/requireAuth');
const lecturersController = require('../../controllers/admin/lecturers.controller');

const router = express.Router();

router.use(requireAdmin);

router.get('/', asyncHandler(lecturersController.list));
router.post('/', asyncHandler(lecturersController.create));
router.patch('/:id', asyncHandler(lecturersController.update));
router.delete('/:id', asyncHandler(lecturersController.remove));

module.exports = router;
