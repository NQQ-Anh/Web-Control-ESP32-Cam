const devicesService = require('../services/devices.service');
const { createHttpError, isPlainObject, parsePagination, assertUuid } = require('../utils/http');

const deviceFields = ['device_code', 'device_name', 'location', 'firmware_version'];
const statuses = new Set(['online', 'offline', 'maintenance']);
const commands = new Set(['unlock', 'lock', 'sync_permissions', 'restart']);

const parseDevicePayload = (body, partial = false) => {
    if (!isPlainObject(body)) throw createHttpError(400, 'Dữ liệu thiết bị không hợp lệ');
    const unknown = Object.keys(body).filter((field) => !deviceFields.includes(field));
    if (unknown.length) throw createHttpError(400, `Trường không được hỗ trợ: ${unknown.join(', ')}`);
    const payload = {};
    for (const field of deviceFields) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        const value = body[field];
        if (value === null && ['location', 'firmware_version'].includes(field)) {
            payload[field] = null;
            continue;
        }
        if (typeof value !== 'string') throw createHttpError(400, `${field} phải là chuỗi`);
        const trimmed = value.trim();
        if (trimmed.length > 255) throw createHttpError(400, `${field} vượt quá độ dài cho phép`);
        if (['device_code', 'device_name'].includes(field) && !trimmed) throw createHttpError(400, `${field} không được để trống`);
        if (field === 'device_code' && !/^[a-zA-Z0-9._-]{2,64}$/.test(trimmed)) throw createHttpError(400, 'Mã thiết bị chỉ được gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang');
        payload[field] = trimmed || null;
    }
    if (!partial && (!payload.device_code || !payload.device_name)) throw createHttpError(400, 'device_code và device_name là bắt buộc');
    if (partial && !Object.keys(payload).length) throw createHttpError(400, 'Không có thông tin cần cập nhật');
    return payload;
};

const list = async (req, res) => {
    const query = { ...req.query };
    if (query.is_active !== undefined) {
        if (!['true', 'false'].includes(query.is_active)) throw createHttpError(400, 'is_active chỉ nhận true hoặc false');
        query.is_active = query.is_active === 'true';
    }
    if (query.status !== undefined && !statuses.has(query.status)) throw createHttpError(400, 'Trạng thái thiết bị không hợp lệ');
    const result = await devicesService.listDevices(query, parsePagination(query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const get = async (req, res) => res.json({ success: true, data: await devicesService.getDevice(assertUuid(req.params.id)) });
const status = async (req, res) => res.json({ success: true, data: await devicesService.getDeviceStatus(assertUuid(req.params.id)) });
const create = async (req, res) => res.status(201).json({ success: true, data: await devicesService.createDevice(parseDevicePayload(req.body), req.user.id) });
const update = async (req, res) => res.json({ success: true, data: await devicesService.updateDevice(assertUuid(req.params.id), parseDevicePayload(req.body, true), req.user.id) });

const setStatus = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || !['offline', 'maintenance'].includes(req.body.status)) throw createHttpError(400, 'Chỉ được đặt offline hoặc maintenance; trạng thái online được cập nhật qua heartbeat');
    return res.json({ success: true, data: await devicesService.setDeviceStatus(req.params.id, req.body.status, req.user.id) });
};

const setActive = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || typeof req.body.is_active !== 'boolean') throw createHttpError(400, 'is_active phải là boolean');
    return res.json({ success: true, data: await devicesService.setDeviceActive(req.params.id, req.body.is_active, req.user.id) });
};

const remove = async (req, res) => res.json({ success: true, message: 'Thiết bị đã được vô hiệu hóa', data: await devicesService.deactivateDevice(assertUuid(req.params.id), req.user.id) });
const rotateCredential = async (req, res) => res.json({ success: true, message: 'Thông tin xác thực mới chỉ hiển thị một lần', data: await devicesService.rotateCredential(assertUuid(req.params.id), req.user.id) });

const listCommands = async (req, res) => {
    const result = await devicesService.listDeviceCommands(assertUuid(req.params.id), parsePagination(req.query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const createCommand = async (req, res) => {
    assertUuid(req.params.id);
    if (!isPlainObject(req.body) || !commands.has(req.body.command) || Object.keys(req.body).some((field) => field !== 'command')) {
        throw createHttpError(400, 'Lệnh thiết bị không hợp lệ');
    }
    const data = await devicesService.createCommand({ deviceId: req.params.id, command: req.body.command, actorId: req.user.id });
    return res.status(202).json({ success: true, message: 'Lệnh đã xếp hàng chờ xác nhận từ thiết bị', data });
};

const listEvents = async (req, res) => {
    const result = await devicesService.listDeviceEvents(assertUuid(req.params.id), parsePagination(req.query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

module.exports = { list, get, status, create, update, setStatus, setActive, remove, rotateCredential, listCommands, createCommand, listEvents };
