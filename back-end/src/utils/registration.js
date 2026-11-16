const { createHttpError, isPlainObject } = require('./http');

const normalizeRegistrationInput = (body) => {
    if (!isPlainObject(body) || Object.keys(body).some((key) => !['full_name', 'email', 'password'].includes(key))) {
        throw createHttpError(400, 'Dữ liệu đăng ký không hợp lệ');
    }

    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!fullName || fullName.length > 255) throw createHttpError(400, 'Họ tên phải có từ 1 đến 255 ký tự');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createHttpError(400, 'Email không hợp lệ');
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
        throw createHttpError(400, 'Mật khẩu phải dài từ 12 đến 128 ký tự');
    }

    return { full_name: fullName, email, password: body.password };
};

module.exports = { normalizeRegistrationInput };
