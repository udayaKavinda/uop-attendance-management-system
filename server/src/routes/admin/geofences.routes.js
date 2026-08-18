const express = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { requireStaff, requireAdmin } = require('../../middlewares/requireAuth');
const geofencesController = require('../../controllers/admin/geofences.controller');

const router = express.Router();

// Any staff member needs the building list to pick from when creating a
// geofence-mode session; only admins draw/manage buildings themselves.
router.get('/', requireStaff, asyncHandler(geofencesController.list));
router.post('/', requireAdmin, asyncHandler(geofencesController.create));
router.patch('/:id', requireAdmin, asyncHandler(geofencesController.update));
router.delete('/:id', requireAdmin, asyncHandler(geofencesController.remove));

module.exports = router;
