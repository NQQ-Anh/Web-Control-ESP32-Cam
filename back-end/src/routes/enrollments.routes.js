const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/enrollments.controller');

router.use(authenticate);
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.get));
router.post('/', authorize('admin', 'operator'), asyncHandler(controller.create));
router.patch('/:id/status', authorize('admin', 'operator'), asyncHandler(controller.setStatus));
router.delete('/:id', authorize('admin', 'operator'), asyncHandler(controller.remove));

module.exports = router;
