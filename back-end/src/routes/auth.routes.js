const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const authenticate = require('../middlewares/auth.middleware');
const { rateLimit } = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau' }
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều lần đăng ký. Hãy thử lại sau ít phút.' }
});

router.get('/me', authenticate, (req, res, next) => Promise.resolve(authController.getMe(req, res)).catch(next));
router.patch('/me', authenticate, (req, res, next) => Promise.resolve(authController.updateMe(req, res)).catch(next));
router.put('/password', authenticate, authLimiter, (req, res, next) => Promise.resolve(authController.changePassword(req, res)).catch(next));
router.post('/accept-invite', authLimiter, (req, res, next) => Promise.resolve(authController.acceptInvite(req, res)).catch(next));
router.post('/register', registerLimiter, (req, res, next) => Promise.resolve(authController.register(req, res)).catch(next));
router.post('/login', authLimiter, (req, res, next) => Promise.resolve(authController.login(req, res)).catch(next));
router.post('/refresh', authLimiter, (req, res, next) => Promise.resolve(authController.refresh(req, res)).catch(next));
router.post('/logout', authenticate, (req, res, next) => Promise.resolve(authController.logout(req, res)).catch(next));

module.exports = router;
