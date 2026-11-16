const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/dashboard.controller');

router.use(authenticate);
router.get('/summary', asyncHandler(controller.summary));
router.get('/access-statistics', asyncHandler(controller.accessStatistics));
router.get('/recent-events', asyncHandler(controller.recentEvents));
router.get('/device-statistics', asyncHandler(controller.deviceStatistics));

module.exports = router;
