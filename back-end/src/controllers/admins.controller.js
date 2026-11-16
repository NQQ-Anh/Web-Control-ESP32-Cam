const service = require('../services/admins.service');
const { createHttpError, isPlainObject, parsePagination, assertUuid } = require('../utils/http');
const roles = new Set(['admin', 'operator', 'viewer']);

const list = async (req, res) => {
    const pagination = parsePagination(req.query);
    const query = { ...pagination };
    if (req.query.role !== undefined) {
        if (!roles.has(req.query.role)) throw createHttpError(400, 'role không hợp lệ');
        query.role = req.query.role;
    }
    if (req.query.is_active !== undefined) {
        if (!['true', 'false'].includes(req.query.is_active)) throw createHttpError(400, 'is_active chỉ nhận true hoặc false');
        query.is_active = req.query.is_active === 'true';
    }
    if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 100)) throw createHttpError(400, 'Từ khóa không hợp lệ');
    query.q = req.query.q;
    const result = await service.listAdmins(query);
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const get = async (req, res) => res.json({ success: true, data: await service.getAdmin(assertUuid(req.params.id)) });

const create = async (req, res) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((field) => !['email', 'full_name', 'role'].includes(field))) throw createHttpError(400, 'Dữ liệu tài khoản không hợp lệ');
    const { email, full_name, role } = req.body;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw createHttpError(400, 'Email không hợp lệ');
    if (typeof full_name !== 'string' || !full_name.trim() || full_name.length > 255) throw createHttpError(400, 'Họ tên không hợp lệ');
    if (!roles.has(role)) throw createHttpError(400, 'role không hợp lệ');
    return res.status(201).json({ success: true, message: 'Đã gửi lời mời xác thực đến địa chỉ email', data: await service.createAdmin({ email: email.trim().toLowerCase(), full_name: full_name.trim(), role }, req.user.id) });
};

const update = async (req, res) => {
    assertUuid(req.params.id);
    const body = req.body;
    if (!isPlainObject(body) || Object.keys(body).some((field) => !['email', 'full_name', 'role'].includes(field))) throw createHttpError(400, 'Dữ liệu cập nhật không hợp lệ');
    if (!Object.keys(body).length) throw createHttpError(400, 'Không có thông tin cần cập nhật');
    const payload = {};
    if (body.email !== undefined) {
        if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) throw createHttpError(400, 'Email không hợp lệ');
        payload.email = body.email.trim().toLowerCase();
    }
    if (body.full_name !== undefined) {
        if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.length > 255) throw createHttpError(400, 'Họ tên không hợp lệ');
        payload.full_name = body.full_name.trim();
    }
    if (body.role !== undefined) {
        if (!roles.has(body.role)) throw createHttpError(400, 'role không hợp lệ');
        payload.role = body.role;
    }
    return res.json({ success: true, data: await service.updateAdmin(req.params.id, payload, req.user.id) });
};

const setStatus = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || typeof req.body.is_active !== 'boolean') throw createHttpError(400, 'is_active phải là boolean');
    return res.json({ success: true, data: await service.setAdminStatus(req.params.id, req.body.is_active, req.user.id) });
};

module.exports = { list, get, create, update, setStatus };
