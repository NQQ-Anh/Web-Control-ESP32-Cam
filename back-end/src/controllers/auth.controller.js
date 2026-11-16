const authService = require('../services/auth.service');
const { createHttpError, isPlainObject } = require('../utils/http');
const { normalizeRegistrationInput } = require('../utils/registration');

const register = async (req, res) => {
    const registration = normalizeRegistrationInput(req.body);
    const result = await authService.register(registration);
    return res.status(result.session ? 201 : 202).json({
        success: true,
        message: result.session
            ? 'Đăng ký thành công'
            : 'Nếu email có thể đăng ký, hướng dẫn xác minh sẽ được gửi đến hộp thư.',
        data: result
    });
};

const login = async (req, res) => {
    if (!isPlainObject(req.body)) throw createHttpError(400, 'Dữ liệu đăng nhập không hợp lệ');
    const { email, password } = req.body;

    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
        throw createHttpError(400, 'Email không hợp lệ');
    }
    if (typeof password !== 'string' || password.length < 1 || password.length > 256) {
        throw createHttpError(400, 'Vui lòng nhập mật khẩu hợp lệ');
    }

    const result = await authService.login(email.trim().toLowerCase(), password);

    return res.status(200).json({
        success: true,
        message: 'Đăng nhập thành công',
        data: result
    });
};

const refresh = async (req, res) => {
    if (!isPlainObject(req.body) || typeof req.body.refresh_token !== 'string' || req.body.refresh_token.length > 4096) {
        throw createHttpError(400, 'Refresh token không hợp lệ');
    }
    return res.json({
        success: true,
        message: 'Đã làm mới phiên đăng nhập',
        data: await authService.refresh(req.body.refresh_token)
    });
};

const logout = async (req, res) => {
    await authService.logout(req.accessToken);
    return res.json({ success: true, message: 'Đã đăng xuất' });
};
const getMe = async (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'Lấy thông tin tài khoản thành công',
        data: req.user
    });
};

const updateMe = async (req, res) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((field) => field !== 'full_name')) throw createHttpError(400, 'Chỉ cho phép cập nhật full_name');
    if (typeof req.body.full_name !== 'string' || !req.body.full_name.trim() || req.body.full_name.length > 255) throw createHttpError(400, 'Họ tên không hợp lệ');
    return res.json({ success: true, data: await authService.updateProfile(req.user.id, req.body.full_name.trim()) });
};

const changePassword = async (req, res) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((field) => field !== 'password')) throw createHttpError(400, 'Dữ liệu đổi mật khẩu không hợp lệ');
    if (typeof req.body.password !== 'string' || req.body.password.length < 12 || req.body.password.length > 128) throw createHttpError(400, 'Mật khẩu mới phải dài từ 12 đến 128 ký tự');
    await authService.changePassword(req.accessToken, req.body.password);
    return res.json({ success: true, message: 'Đã đổi mật khẩu' });
};

const acceptInvite = async (req, res) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((field) => !['token_hash', 'password'].includes(field))) throw createHttpError(400, 'Dữ liệu xác minh lời mời không hợp lệ');
    if (typeof req.body.token_hash !== 'string' || req.body.token_hash.length < 16 || req.body.token_hash.length > 2048) throw createHttpError(400, 'Liên kết mời không hợp lệ');
    if (typeof req.body.password !== 'string' || req.body.password.length < 12 || req.body.password.length > 128) throw createHttpError(400, 'Mật khẩu phải dài từ 12 đến 128 ký tự');
    return res.json({ success: true, message: 'Tài khoản đã được xác minh', data: await authService.acceptInvite(req.body.token_hash, req.body.password) });
};

module.exports = {
    register,
    login,
    getMe,
    refresh,
    logout,
    updateMe,
    changePassword,
    acceptInvite
};
