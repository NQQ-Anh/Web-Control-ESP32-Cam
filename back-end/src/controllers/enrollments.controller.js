const service = require('../services/enrollments.service');
const { createHttpError, isPlainObject, parsePagination, assertUuid } = require('../utils/http');
const statuses = new Set(['pending', 'completed', 'failed', 'revoked']);

const list = async (req, res) => {
    const query = { ...req.query };
    for (const field of ['user_id', 'device_id']) if (query[field]) query[field] = assertUuid(query[field], field);
    if (query.status !== undefined && !statuses.has(query.status)) throw createHttpError(400, 'Trạng thái enrollment không hợp lệ');
    const result = await service.listEnrollments(query, parsePagination(query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const get = async (req, res) => res.json({ success: true, data: await service.getEnrollment(assertUuid(req.params.id)) });

const create = async (req, res) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((field) => !['user_id', 'device_id'].includes(field))) throw createHttpError(400, 'Dữ liệu enrollment không hợp lệ');
    const userId = assertUuid(req.body.user_id, 'user_id');
    const deviceId = assertUuid(req.body.device_id, 'device_id');
    return res.status(202).json({ success: true, message: 'Yêu cầu đã tạo và đang chờ thiết bị nhận, thực hiện tại chỗ, rồi báo kết quả', data: await service.createEnrollment({ userId, deviceId, actorId: req.user.id }) });
};

const setStatus = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || req.body.status !== 'revoked' || Object.keys(req.body).some((field) => field !== 'status')) {
        throw createHttpError(400, 'Chỉ cho phép thu hồi enrollment từ giao diện quản trị');
    }
    return res.json({ success: true, data: await service.revokeEnrollment(req.params.id, req.user.id) });
};

const remove = async (req, res) => res.json({ success: true, message: 'Enrollment đã được thu hồi; dữ liệu khuôn mặt không được tải lên', data: await service.revokeEnrollment(assertUuid(req.params.id), req.user.id) });

module.exports = { list, get, create, setStatus, remove };
