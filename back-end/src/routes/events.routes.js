const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/events.controller');

router.use(authenticate);
router.get('/export', asyncHandler(controller.exportCsv));
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.get));

module.exports = router;
