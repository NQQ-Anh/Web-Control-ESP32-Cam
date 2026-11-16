const usersService = require('../services/users.service');
const { createHttpError, isPlainObject, parsePagination, assertUuid } = require('../utils/http');

const allowedFields = ['employee_code', 'full_name', 'email', 'phone', 'department', 'avatar_url', 'notes'];

const parseUserPayload = (body, partial = false) => {
    if (!isPlainObject(body)) throw createHttpError(400, 'Dữ liệu người dùng không hợp lệ');
    const unknown = Object.keys(body).filter((field) => !allowedFields.includes(field));
    if (unknown.length) throw createHttpError(400, `Trường không được hỗ trợ: ${unknown.join(', ')}`);

    const payload = {};
    for (const field of allowedFields) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        const value = body[field];
        if (value === null && ['employee_code', 'email', 'phone', 'department', 'avatar_url', 'notes'].includes(field)) {
            payload[field] = null;
            continue;
        }
        if (typeof value !== 'string') throw createHttpError(400, `${field} phải là chuỗi`);
        const trimmed = value.trim();
        const maxLength = field === 'notes' ? 2000 : field === 'avatar_url' ? 2048 : 255;
        if (trimmed.length > maxLength) throw createHttpError(400, `${field} vượt quá độ dài cho phép`);
        if (field === 'full_name' && !trimmed) throw createHttpError(400, 'Họ tên không được để trống');
        if (field === 'email' && trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw createHttpError(400, 'Email không hợp lệ');
        if (field === 'avatar_url' && trimmed) {
            let url;
            try { url = new URL(trimmed); } catch { throw createHttpError(400, 'Địa chỉ ảnh đại diện không hợp lệ'); }
            if (!['https:', 'http:'].includes(url.protocol)) throw createHttpError(400, 'Địa chỉ ảnh đại diện không hợp lệ');
        }
        payload[field] = trimmed || (field === 'full_name' ? '' : null);
    }

    if (!partial && !payload.full_name) throw createHttpError(400, 'Họ tên là trường bắt buộc');
    if (partial && !Object.keys(payload).length) throw createHttpError(400, 'Không có thông tin cần cập nhật');
    return payload;
};

const list = async (req, res) => {
    const query = { ...req.query };
    if (query.is_active !== undefined) {
        if (!['true', 'false'].includes(query.is_active)) throw createHttpError(400, 'is_active chỉ nhận true hoặc false');
        query.is_active = query.is_active === 'true';
    }
    const result = await usersService.listUsers(query, parsePagination(query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const get = async (req, res) => res.json({ success: true, data: await usersService.getUser(assertUuid(req.params.id)) });
const create = async (req, res) => res.status(201).json({ success: true, data: await usersService.createUser(parseUserPayload(req.body), req.user.id) });
const update = async (req, res) => res.json({ success: true, data: await usersService.updateUser(assertUuid(req.params.id), parseUserPayload(req.body, true), req.user.id) });

const setStatus = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || typeof req.body.is_active !== 'boolean') throw createHttpError(400, 'is_active phải là boolean');
    return res.json({ success: true, data: await usersService.setUserStatus(req.params.id, req.body.is_active, req.user.id) });
};

const remove = async (req, res) => res.json({
    success: true,
    message: 'Người dùng đã được vô hiệu hóa; lịch sử truy cập được giữ nguyên',
    data: await usersService.setUserStatus(assertUuid(req.params.id), false, req.user.id)
});

module.exports = { list, get, create, update, setStatus, remove };
