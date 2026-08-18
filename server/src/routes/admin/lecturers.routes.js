const express = require('express');
const { requireAdmin } = require('../../middlewares/requireAuth');
const lecturersController = require('../../controllers/admin/lecturers.controller');

const router = express.Router();

router.use(requireAdmin);

router.get('/', lecturersController.list);
router.post('/', lecturersController.create);
router.delete('/:id', lecturersController.remove);

module.exports = router;
