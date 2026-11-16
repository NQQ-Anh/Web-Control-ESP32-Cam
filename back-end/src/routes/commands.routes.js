const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/commands.controller');

router.get('/:id', authenticate, asyncHandler(controller.get));

module.exports = router;
