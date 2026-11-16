const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, listResource, getById, updateOne } = require('./resource.service');
const { recordAudit } = require('./audit.service');
const { createHttpError } = require('../utils/http');

const deviceSelect = 'id, device_code, device_name, location, status, door_state, door_state_updated_at, firmware_version, last_seen_at, is_active, created_at, updated_at';
const jwtSecret = () => {
    const secret = process.env.DEVICE_TOKEN_SECRET || process.env.DEVICE_JWT_SECRET;
    if (!secret || secret.length < 32) throw createHttpError(503, 'Xác thực thiết bị chưa được cấu hình trên máy chủ');
    return secret;
};

const listDevices = (query, pagination) => listResource({
    table: 'devices', query, pagination,
    searchable: ['device_code', 'device_name', 'location'],
    filters: { status: query.status, is_active: query.is_active },
    select: deviceSelect
});

const createDevice = async (payload, actorId) => {
    const credential = crypto.randomBytes(32).toString('base64url');
    const { data, error } = await supabase.rpc('create_access_device', {
        p_device_code: payload.device_code,
        p_device_name: payload.device_name,
        p_location: payload.location ?? null,
        p_firmware_version: payload.firmware_version ?? null,
        p_device_token_hash: await bcrypt.hash(credential, 12),
        p_actor_id: actorId
    });
    if (error) throw require('./resource.service').databaseError(error, 'Không thể tạo thiết bị');
    const device = await getById('devices', data.id, deviceSelect);
    return { device, device_credential: credential };
};

const updateDevice = async (id, payload, actorId) => {
    const device = await updateOne('devices', id, { ...payload, updated_at: new Date().toISOString() }, deviceSelect);
    await recordAudit({ actorId, action: 'device.update', resourceType: 'device', resourceId: id, metadata: { fields: Object.keys(payload) } });
    return device;
};

const setDeviceStatus = async (id, status, actorId) => {
    if (!['offline', 'maintenance'].includes(status)) throw createHttpError(400, 'Trạng thái online chỉ được đặt bởi heartbeat thiết bị');
    const current = await getById('devices', id, 'id, is_active');
    if (!current.is_active) throw createHttpError(409, 'Hãy kích hoạt thiết bị trước khi thay đổi trạng thái vận hành');
    const device = await updateOne('devices', id, { status, updated_at: new Date().toISOString() }, deviceSelect);
    await recordAudit({ actorId, action: 'device.status', resourceType: 'device', resourceId: id, metadata: { status } });
    return device;
};

const deactivateDevice = async (id, actorId) => {
    const device = await setDeviceActive(id, false, actorId);
    return device;
};

const rotateCredential = async (id, actorId) => {
    const credential = crypto.randomBytes(32).toString('base64url');
    const { data, error } = await supabase.rpc('rotate_device_credential', {
        p_device_id: id,
        p_device_token_hash: await bcrypt.hash(credential, 12),
        p_actor_id: actorId
    });
    if (error) throw require('./resource.service').databaseError(error, 'Không thể cấp lại thông tin xác thực thiết bị');
    return { device: await getById('devices', data.id, deviceSelect), device_credential: credential };
};

const setDeviceActive = async (id, isActive, actorId) => {
    const { data, error } = await supabase.rpc('set_device_active', { p_device_id: id, p_is_active: isActive, p_actor_id: actorId });
    if (error) throw require('./resource.service').databaseError(error, 'Không thể cập nhật trạng thái thiết bị');
    return getById('devices', data.id, deviceSelect);
};

const createCommand = async ({ deviceId, command, actorId, payload = {} }) => {
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + (['unlock', 'lock'].includes(command) ? 30_000 : 120_000));
    const onlineThresholdSeconds = Math.min(900, Math.max(30, Number.parseInt(process.env.DEVICE_OFFLINE_THRESHOLD_SECONDS, 10) || 120));
    const { data: row, error } = await supabase.rpc('create_device_command', {
        p_device_id: deviceId,
        p_command: command,
        p_payload: payload,
        p_actor_id: actorId,
        p_expires_at: expiresAt.toISOString(),
        p_online_max_age_seconds: onlineThresholdSeconds
    });
    if (error) throw require('./resource.service').databaseError(error, 'Không thể xếp hàng lệnh thiết bị');
    return row;
};

const listDeviceCommands = async (deviceId, pagination) => {
    await getById('devices', deviceId, 'id');
    let query = supabase.from('device_commands').select('*', { count: 'exact' }).eq('device_id', deviceId)
        .order('requested_at', { ascending: false }).range(pagination.from, pagination.to);
    const { data, error, count } = await query;
    if (error) throw require('./resource.service').databaseError(error);
    return { items: data || [], pagination: { page: pagination.page, limit: pagination.limit, total: count || 0 } };
};

const getCommand = async (id) => {
    const { data, error } = await supabase.from('device_commands').select('*').eq('id', id).maybeSingle();
    if (error) throw require('./resource.service').databaseError(error);
    if (!data) throw createHttpError(404, 'Không tìm thấy lệnh thiết bị');
    if (['pending', 'sent'].includes(data.status) && data.expires_at && Date.parse(data.expires_at) <= Date.now()) {
        const now = new Date().toISOString();
        const { data: expired, error: expireError } = await supabase.from('device_commands').update({ status: 'expired' })
            .eq('id', id).in('status', ['pending', 'sent']).lt('expires_at', now).select('*').maybeSingle();
        if (expireError) throw require('./resource.service').databaseError(expireError);
        if (expired) return expired;
        const { data: current, error: currentError } = await supabase.from('device_commands').select('*').eq('id', id).maybeSingle();
        if (currentError) throw require('./resource.service').databaseError(currentError);
        return current || data;
    }
    return data;
};

const listDeviceEvents = async (deviceId, pagination) => {
    await getById('devices', deviceId, 'id');
    const { data, error, count } = await supabase.from('access_events')
        .select('id, user_id, decision, confidence, event_source, reason, occurred_at', { count: 'exact' })
        .eq('device_id', deviceId).order('occurred_at', { ascending: false })
        .range(pagination.from, pagination.to);
    if (error) throw require('./resource.service').databaseError(error);
    return { items: data || [], pagination: { page: pagination.page, limit: pagination.limit, total: count || 0 } };
};

const authenticateDevice = async (deviceId, credential) => {
    const { data: device, error } = await supabase.from('devices')
        .select('id, device_token_hash, is_active').eq('id', deviceId).maybeSingle();
    if (error) throw require('./resource.service').databaseError(error, 'Không thể xác minh thiết bị');
    if (!device || !device.is_active || !device.device_token_hash || !(await bcrypt.compare(credential, device.device_token_hash))) {
        throw createHttpError(401, 'Thông tin xác thực thiết bị không hợp lệ');
    }
    const credentialVersion = crypto.createHash('sha256').update(device.device_token_hash).digest('hex');
    return jwt.sign({ type: 'device', credential_version: credentialVersion }, jwtSecret(), {
        subject: device.id,
        issuer: 'face-access-control-api',
        audience: 'face-access-control-devices',
        expiresIn: '5m'
    });
};

const verifyDeviceToken = async (token, requestedDeviceId) => {
    let claims;
    try {
        claims = jwt.verify(token, jwtSecret(), { issuer: 'face-access-control-api', audience: 'face-access-control-devices' });
    } catch {
        throw createHttpError(401, 'Token thiết bị không hợp lệ hoặc đã hết hạn');
    }
    if (claims.type !== 'device' || claims.sub !== requestedDeviceId) throw createHttpError(401, 'Token không thuộc thiết bị này');

    const { data: device, error } = await supabase.from('devices')
        .select('id, device_token_hash, is_active').eq('id', requestedDeviceId).maybeSingle();
    if (error) throw require('./resource.service').databaseError(error, 'Không thể xác minh thiết bị');
    const currentVersion = device?.device_token_hash
        ? crypto.createHash('sha256').update(device.device_token_hash).digest('hex')
        : '';
    if (!device || !device.is_active || claims.credential_version !== currentVersion) {
        throw createHttpError(401, 'Thiết bị không hoạt động hoặc token đã bị thu hồi');
    }
    return { id: device.id };
};

module.exports = {
    listDevices,
    getDevice: (id) => getById('devices', id, deviceSelect),
    getDeviceStatus: async (id) => getById('devices', id, 'id, device_code, device_name, status, door_state, door_state_updated_at, last_seen_at, is_active'),
    createDevice,
    updateDevice,
    setDeviceStatus,
    deactivateDevice,
    setDeviceActive,
    rotateCredential,
    createCommand,
    listDeviceCommands,
    getCommand,
    listDeviceEvents,
    authenticateDevice,
    verifyDeviceToken
};
