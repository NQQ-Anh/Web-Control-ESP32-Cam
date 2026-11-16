const express = require('express');
const router = express.Router();

const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/admins.controller');

router.use(authenticate, authorize('admin'));

router.get(
    '/test',
    (req, res) => {
        res.status(200).json({
            success: true,
            message: 'Bạn có quyền truy cập khu vực Admin',
            user: req.user
        });
    }
);

router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.get));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.patch('/:id/status', asyncHandler(controller.setStatus));

module.exports = router;
