const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/deviceApi.controller');
const { requireFreshRequest, authenticateDevice, requireDeviceTls } = require('../middlewares/device.middleware');

const deviceAuthLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều lần xác thực thiết bị' }
});

router.post('/auth', requireDeviceTls, deviceAuthLimiter, requireFreshRequest, asyncHandler(controller.authenticate));
router.use(authenticateDevice);
router.get('/sync', asyncHandler(controller.sync));
router.post('/heartbeat', requireFreshRequest, asyncHandler(controller.heartbeat));
router.get('/commands/pending', asyncHandler(controller.pendingCommands));
router.post('/events', requireFreshRequest, asyncHandler(controller.accessEvent));
router.post('/commands/:id/ack', requireFreshRequest, asyncHandler(controller.acknowledge));
router.post('/enrollments/:id/result', requireFreshRequest, asyncHandler(controller.enrollmentResult));

module.exports = router;
