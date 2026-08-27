const express = require('express');
const { requireStaff, requireAdmin } = require('../../middlewares/requireAuth');
const lecturersController = require('../../controllers/admin/lecturers.controller');

const router = express.Router();

// Any staff member may look up the lecturer directory (e.g. to find a co-owner to
// add to a course they own); creating/removing lecturers stays admin-only.
router.get('/', requireStaff, lecturersController.list);
router.post('/', requireAdmin, lecturersController.create);
router.delete('/:id', requireAdmin, lecturersController.remove);

module.exports = router;
