const { createHttpError, assertUuid } = require('../utils/http');
const devicesService = require('../services/devices.service');

const consumedNonces = new Map();
const MAX_CLOCK_SKEW_MS = 90_000;
const NONCE_TTL_MS = MAX_CLOCK_SKEW_MS * 2;

const requireFreshRequest = (req, _res, next) => {
    const rawTimestamp = req.get('x-device-timestamp');
    const nonce = req.get('x-device-nonce');
    const timestampValue = Number(rawTimestamp);
    const timestampMs = timestampValue > 1_000_000_000_000 ? timestampValue : timestampValue * 1000;

    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
        return next(createHttpError(401, 'Yêu cầu thiết bị thiếu timestamp hợp lệ hoặc đã quá hạn'));
    }
    if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) {
        return next(createHttpError(400, 'X-Device-Nonce không hợp lệ'));
    }

    const now = Date.now();
    for (const [key, expiresAt] of consumedNonces) {
        if (expiresAt <= now) consumedNonces.delete(key);
    }
    const nonceKey = `${req.device?.id || req.body?.device_id || 'unknown'}:${nonce}`;
    if (consumedNonces.has(nonceKey)) return next(createHttpError(409, 'Yêu cầu thiết bị đã được gửi trước đó'));
    if (consumedNonces.size > 100_000) return next(createHttpError(503, 'Bộ nhớ chống phát lại đang quá tải'));
    consumedNonces.set(nonceKey, now + NONCE_TTL_MS);
    return next();
};

const authenticateDevice = async (req, _res, next) => {
    try {
        const deviceId = assertUuid(req.get('x-device-id'), 'X-Device-Id');
        const authHeader = req.get('authorization');
        if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) throw createHttpError(401, 'Thiếu token thiết bị');
        const token = authHeader.slice(authHeader.indexOf(' ') + 1).trim();
        req.device = await devicesService.verifyDeviceToken(token, deviceId);
        return next();
    } catch (error) {
        return next(error);
    }
};

const requireDeviceTls = (req, _res, next) => {
    if (process.env.NODE_ENV === 'production' && !req.secure) {
        return next(createHttpError(400, 'API thiết bị chỉ chấp nhận HTTPS'));
    }
    return next();
};

module.exports = { requireFreshRequest, authenticateDevice, requireDeviceTls };
