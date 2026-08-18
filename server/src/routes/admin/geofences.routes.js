const express = require('express');
const { requireStaff, requireAdmin } = require('../../middlewares/requireAuth');
const geofencesController = require('../../controllers/admin/geofences.controller');

const router = express.Router();

// Any staff member needs the building list to pick from when creating a
// geofence-mode session; only admins draw/manage buildings themselves.
router.get('/', requireStaff, geofencesController.list);
router.post('/', requireAdmin, geofencesController.create);
router.patch('/:id', requireAdmin, geofencesController.update);
router.delete('/:id', requireAdmin, geofencesController.remove);

module.exports = router;
