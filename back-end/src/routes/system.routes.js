const express = require('express');
const authenticate = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/system.controller');

const router = express.Router();
router.get('/status', authenticate, asyncHandler(controller.status));

module.exports = router;
