const service = require('../services/permissions.service');
const { createHttpError, isPlainObject, parsePagination, assertUuid } = require('../utils/http');

const fields = ['user_id', 'device_id', 'valid_from', 'valid_until', 'is_allowed', 'reason'];
const parsePayload = (body, partial = false) => {
    if (!isPlainObject(body)) throw createHttpError(400, 'Dữ liệu quyền truy cập không hợp lệ');
    if (Object.keys(body).some((field) => !fields.includes(field))) throw createHttpError(400, 'Dữ liệu quyền chứa trường không được hỗ trợ');
    const payload = {};
    for (const field of ['user_id', 'device_id']) {
        if (body[field] !== undefined) payload[field] = assertUuid(body[field], field);
    }
    for (const field of ['valid_from', 'valid_until']) {
        if (body[field] === undefined) continue;
        if (body[field] === null && field === 'valid_until') { payload[field] = null; continue; }
        if (typeof body[field] !== 'string' || Number.isNaN(Date.parse(body[field]))) throw createHttpError(400, `${field} phải là thời gian ISO hợp lệ`);
        payload[field] = new Date(body[field]).toISOString();
    }
    if (body.is_allowed !== undefined) {
        if (typeof body.is_allowed !== 'boolean') throw createHttpError(400, 'is_allowed phải là boolean');
        payload.is_allowed = body.is_allowed;
    }
    if (body.reason !== undefined) {
        if (body.reason !== null && typeof body.reason !== 'string') throw createHttpError(400, 'reason phải là chuỗi');
        if (typeof body.reason === 'string' && body.reason.length > 1000) throw createHttpError(400, 'reason vượt quá độ dài cho phép');
        payload.reason = body.reason === null || !body.reason.trim() ? null : body.reason.trim();
    }
    if (!partial && (!payload.user_id || !payload.device_id)) throw createHttpError(400, 'user_id và device_id là bắt buộc');
    if (partial && !Object.keys(payload).length) throw createHttpError(400, 'Không có thông tin cần cập nhật');
    const validFrom = payload.valid_from ? Date.parse(payload.valid_from) : Date.now();
    const validUntil = payload.valid_until ? Date.parse(payload.valid_until) : null;
    if (validUntil !== null && validUntil <= validFrom) throw createHttpError(400, 'valid_until phải sau valid_from');
    return payload;
};

const list = async (req, res) => {
    const query = { ...req.query };
    for (const field of ['user_id', 'device_id']) if (query[field]) query[field] = assertUuid(query[field], field);
    if (query.is_allowed !== undefined) {
        if (!['true', 'false'].includes(query.is_allowed)) throw createHttpError(400, 'is_allowed chỉ nhận true hoặc false');
        query.is_allowed = query.is_allowed === 'true';
    }
    const result = await service.listPermissions(query, parsePagination(query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const get = async (req, res) => res.json({ success: true, data: await service.getPermission(assertUuid(req.params.id)) });
const create = async (req, res) => res.status(201).json({ success: true, data: await service.createPermission(parsePayload(req.body), req.user.id) });
const update = async (req, res) => res.json({ success: true, data: await service.updatePermission(assertUuid(req.params.id), parsePayload(req.body, true), req.user.id) });

const setStatus = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || typeof req.body.is_allowed !== 'boolean') throw createHttpError(400, 'is_allowed phải là boolean');
    return res.json({ success: true, data: await service.setPermissionStatus(req.params.id, req.body.is_allowed, req.user.id) });
};

const remove = async (req, res) => res.json({ success: true, message: 'Quyền đã được thu hồi', data: await service.revokePermission(assertUuid(req.params.id), req.user.id) });

module.exports = { list, get, create, update, setStatus, remove };
