const express = require('express');
const authenticate = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/history.controller');

const router = express.Router();
router.use(authenticate);
router.get('/export', asyncHandler(controller.exportCsv));
router.get('/', asyncHandler(controller.list));

module.exports = router;
