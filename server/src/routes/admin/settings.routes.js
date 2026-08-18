const express = require('express');
const { requireStaff, requireAdmin } = require('../../middlewares/requireAuth');
const settingsController = require('../../controllers/admin/settings.controller');

const router = express.Router();

// Readable by any staff (matches /admin/courses, /admin/sessions): a lecturer
// needs `allowedModes` to render the create-session mode picker correctly.
// Only admins may change settings.
router.get('/', requireStaff, settingsController.get);
router.patch('/', requireAdmin, settingsController.update);

module.exports = router;
