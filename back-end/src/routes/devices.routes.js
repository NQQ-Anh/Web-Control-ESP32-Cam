const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/devices.controller');

router.use(authenticate);
router.get('/', asyncHandler(controller.list));
router.get('/:id/status', asyncHandler(controller.status));
router.get('/:id', asyncHandler(controller.get));
router.post('/', authorize('admin', 'operator'), asyncHandler(controller.create));
router.put('/:id', authorize('admin', 'operator'), asyncHandler(controller.update));
router.patch('/:id/status', authorize('admin', 'operator'), asyncHandler(controller.setStatus));
router.patch('/:id/active', authorize('admin', 'operator'), asyncHandler(controller.setActive));
router.post('/:id/credentials/rotate', authorize('admin'), asyncHandler(controller.rotateCredential));
router.get('/:id/events', asyncHandler(controller.listEvents));
router.get('/:id/commands', asyncHandler(controller.listCommands));
router.post('/:id/commands', authorize('admin', 'operator'), asyncHandler(controller.createCommand));
router.delete('/:id', authorize('admin', 'operator'), asyncHandler(controller.remove));

module.exports = router;
