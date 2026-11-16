const devicesService = require('../services/devices.service');
const deviceApiService = require('../services/deviceApi.service');
const { createHttpError, isPlainObject, assertUuid } = require('../utils/http');

const authenticate = async (req, res) => {
    if (!isPlainObject(req.body)) throw createHttpError(400, 'Dữ liệu xác thực thiết bị không hợp lệ');
    const deviceId = assertUuid(req.body.device_id, 'device_id');
    if (typeof req.body.credential !== 'string' || req.body.credential.length < 32 || req.body.credential.length > 256) {
        throw createHttpError(401, 'Thông tin xác thực thiết bị không hợp lệ');
    }
    const accessToken = await devicesService.authenticateDevice(deviceId, req.body.credential);
    return res.json({ success: true, data: { access_token: accessToken, token_type: 'Bearer', expires_in: 300 } });
};

const sync = async (req, res) => {
    let sinceVersion;
    if (req.query.since_version !== undefined) {
        sinceVersion = Number(req.query.since_version);
        if (!Number.isSafeInteger(sinceVersion) || sinceVersion < 0) throw createHttpError(400, 'since_version không hợp lệ');
    }
    return res.json(await deviceApiService.syncDevice(req.device.id, sinceVersion));
};

const heartbeat = async (req, res) => {
    if (!isPlainObject(req.body)) throw createHttpError(400, 'Heartbeat không hợp lệ');
    const unknown = Object.keys(req.body).filter((field) => !['firmware_version', 'door_state'].includes(field));
    if (unknown.length) throw createHttpError(400, 'Heartbeat chứa trường không được hỗ trợ');
    if (req.body.firmware_version !== undefined && (typeof req.body.firmware_version !== 'string' || req.body.firmware_version.length > 100)) {
        throw createHttpError(400, 'firmware_version không hợp lệ');
    }
    if (req.body.door_state !== undefined && !['locked', 'unlocked', 'unknown'].includes(req.body.door_state)) {
        throw createHttpError(400, 'door_state chỉ nhận locked, unlocked hoặc unknown');
    }
    const data = await deviceApiService.heartbeat(req.device.id, req.body);
    return res.json({ success: true, data });
};

const pendingCommands = async (req, res) => res.json({ success: true, data: await deviceApiService.listPendingCommands(req.device.id) });

const accessEvent = async (req, res) => {
    const idempotencyKey = req.get('idempotency-key');
    if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)) {
        throw createHttpError(400, 'Idempotency-Key hợp lệ là bắt buộc');
    }
    if (!isPlainObject(req.body)) throw createHttpError(400, 'Sự kiện truy cập không hợp lệ');
    const allowed = ['user_id', 'decision', 'confidence', 'reason', 'occurred_at'];
    if (Object.keys(req.body).some((field) => !allowed.includes(field))) throw createHttpError(400, 'Sự kiện chứa trường không được hỗ trợ');
    if (!['allowed', 'denied'].includes(req.body.decision)) throw createHttpError(400, 'decision chỉ nhận allowed hoặc denied');
    if (req.body.user_id !== undefined && req.body.user_id !== null) assertUuid(req.body.user_id, 'user_id');
    if (req.body.confidence !== undefined && req.body.confidence !== null && (typeof req.body.confidence !== 'number' || !Number.isFinite(req.body.confidence) || req.body.confidence < 0 || req.body.confidence > 1)) {
        throw createHttpError(400, 'confidence phải nằm trong khoảng 0 đến 1');
    }
    if (req.body.reason !== undefined && (typeof req.body.reason !== 'string' || req.body.reason.length > 255)) throw createHttpError(400, 'reason không hợp lệ');
    const result = await deviceApiService.recordAccessEvent(req.device.id, idempotencyKey, req.body);
    return res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, data: result.event });
};

const acknowledge = async (req, res) => {
    assertUuid(req.params.id, 'command_id');
    const body = req.body;
    if (!isPlainObject(body) || !['acknowledged', 'failed'].includes(body.status)) throw createHttpError(400, 'status phải là acknowledged hoặc failed');
    const allowed = ['status', 'response', 'error_message'];
    if (Object.keys(body).some((field) => !allowed.includes(field))) throw createHttpError(400, 'Phản hồi lệnh chứa trường không được hỗ trợ');
    if (body.error_message !== undefined && (typeof body.error_message !== 'string' || body.error_message.length > 255)) throw createHttpError(400, 'error_message không hợp lệ');
    if (body.response !== undefined && body.response !== null) {
        if (!isPlainObject(body.response) || Buffer.byteLength(JSON.stringify(body.response), 'utf8') > 4096) throw createHttpError(400, 'response phải là object tối đa 4 KB');
    }
    const data = await deviceApiService.acknowledgeCommand(req.device.id, req.params.id, body);
    return res.json({ success: true, data });
};

const enrollmentResult = async (req, res) => {
    assertUuid(req.params.id, 'enrollment_id');
    if (!isPlainObject(req.body) || !['completed', 'failed'].includes(req.body.status) || Object.keys(req.body).some((field) => field !== 'status')) {
        throw createHttpError(400, 'Kết quả enrollment chỉ nhận completed hoặc failed');
    }
    const data = await deviceApiService.recordEnrollmentResult(req.device.id, req.params.id, req.body.status);
    return res.json({ success: true, data });
};

module.exports = { authenticate, sync, heartbeat, pendingCommands, accessEvent, acknowledge, enrollmentResult };
