const { supabase, databaseError, getById } = require('./resource.service');
const { createHttpError } = require('../utils/http');

const MAX_OFFLINE_CACHE_AGE_SECONDS = Math.min(900, Math.max(30, Number.parseInt(process.env.DEVICE_OFFLINE_MAX_AGE_SECONDS, 10) || 300));

const heartbeat = async (deviceId, body = {}) => {
    const { data: current, error: readError } = await supabase.from('devices')
        .select('id, status, is_active').eq('id', deviceId).maybeSingle();
    if (readError) throw databaseError(readError, 'Không thể cập nhật thiết bị');
    if (!current || !current.is_active) throw createHttpError(403, 'Thiết bị đã bị vô hiệu hóa');

    const now = new Date().toISOString();
    const values = { last_seen_at: now, updated_at: now };
    if (current.status !== 'maintenance') values.status = 'online';
    if (typeof body.firmware_version === 'string' && body.firmware_version.trim()) values.firmware_version = body.firmware_version.trim();
    if (body.door_state !== undefined) {
        values.door_state = body.door_state;
        values.door_state_updated_at = now;
    }
    const { data, error } = await supabase.from('devices').update(values).eq('id', deviceId)
        .select('id, status, door_state, door_state_updated_at, last_seen_at').single();
    if (error) throw databaseError(error, 'Không thể cập nhật heartbeat');
    return data;
};

const bumpPermissionVersion = async (deviceId) => {
    const { data, error } = await supabase.rpc('bump_device_permission_version', { p_device_id: deviceId });
    if (error) throw databaseError(error, 'Không thể tăng phiên bản đồng bộ thiết bị');
    return Number(data);
};

const syncDevice = async (deviceId, sinceVersion) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: state, error: stateError } = await supabase.from('device_sync_state')
        .select('permission_version').eq('device_id', deviceId).maybeSingle();
    if (stateError) throw databaseError(stateError, 'Không thể đọc trạng thái đồng bộ');
    const version = Number(state?.permission_version || 0);

    const { data: pendingEnrollments, error: enrollmentError } = await supabase.from('face_enrollments')
        .select('id, user_id, status, created_at, updated_at').eq('device_id', deviceId)
        .in('status', ['pending', 'completed', 'revoked']).order('updated_at', { ascending: true }).limit(5000);
    if (enrollmentError) throw databaseError(enrollmentError, 'Không thể đọc trạng thái đăng ký khuôn mặt');

    const response = {
        success: true,
        device_id: deviceId,
        permission_version: version,
        server_time: nowIso,
        expires_at: new Date(now.getTime() + MAX_OFFLINE_CACHE_AGE_SECONDS * 1000).toISOString(),
        offline_policy: { allow_access: false, deny_if_cache_older_than_seconds: MAX_OFFLINE_CACHE_AGE_SECONDS },
        enrollments: (pendingEnrollments || []).map(({ id, user_id, status, created_at, updated_at }) => ({ id, user_id, status, created_at, updated_at }))
    };

    if (Number.isSafeInteger(sinceVersion) && sinceVersion === version) {
        response.not_modified = true;
        await supabase.from('device_sync_state').upsert({ device_id: deviceId, last_synced_at: nowIso, updated_at: nowIso }, { onConflict: 'device_id' });
        return response;
    }

    const { data: permissions, error } = await supabase.from('access_permissions')
        .select('id, user_id, is_allowed, valid_from, valid_until, access_users!inner(is_active)')
        .eq('device_id', deviceId).lte('valid_from', nowIso)
        .or(`valid_until.is.null,valid_until.gt.${nowIso}`)
        .order('updated_at', { ascending: true }).limit(5001);
    if (error) throw databaseError(error, 'Không thể đồng bộ quyền truy cập');
    if ((permissions || []).length > 5000) throw createHttpError(413, 'Thiết bị có quá nhiều quyền để đồng bộ trong một lần');

    response.not_modified = false;
    response.permissions = (permissions || [])
        .filter((row) => row.access_users?.is_active === true)
        .map(({ id, user_id, is_allowed, valid_from, valid_until }) => ({ id, user_id, is_allowed, valid_from, valid_until }));

    const { error: touchError } = await supabase.from('device_sync_state')
        .upsert({ device_id: deviceId, last_synced_at: nowIso, updated_at: nowIso }, { onConflict: 'device_id' });
    if (touchError) throw databaseError(touchError, 'Không thể lưu thời gian đồng bộ');
    return response;
};

const listPendingCommands = async (deviceId) => {
    const now = new Date().toISOString();
    const { error: expireError } = await supabase.from('device_commands').update({ status: 'expired' })
        .eq('device_id', deviceId).in('status', ['pending', 'sent']).lt('expires_at', now);
    if (expireError) throw databaseError(expireError, 'Không thể hết hạn lệnh cũ');

    const { data: commands, error } = await supabase.from('device_commands').select('*')
        .eq('device_id', deviceId).in('status', ['pending', 'sent']).gte('expires_at', now)
        .order('requested_at', { ascending: true }).limit(50);
    if (error) throw databaseError(error, 'Không thể lấy lệnh đang chờ');

    const pendingIds = (commands || []).filter((command) => command.status === 'pending').map((command) => command.id);
    if (pendingIds.length) {
        const { error: sentError } = await supabase.from('device_commands').update({ status: 'sent' })
            .eq('device_id', deviceId).in('id', pendingIds).eq('status', 'pending');
        if (sentError) throw databaseError(sentError, 'Không thể đánh dấu lệnh đã gửi');
    }
    // Sent commands may be delivered more than once. Firmware must persist command IDs
    // and execute each ID at most once, then acknowledge it.
    return commands || [];
};

const acknowledgeCommand = async (deviceId, commandId, body) => {
    const { data, error } = await supabase.rpc('acknowledge_device_command', {
        p_command_id: commandId,
        p_device_id: deviceId,
        p_status: body.status,
        p_response: body.response || null,
        p_error_message: body.status === 'failed' ? (body.error_message || 'Thiết bị báo lệnh thất bại') : null
    });
    if (error) throw databaseError(error, 'Không thể xác nhận kết quả lệnh');
    if (data?.status === 'expired') throw createHttpError(409, 'Lệnh đã hết hạn');
    return data;
};

const recordAccessEvent = async (deviceId, idempotencyKey, body) => {
    const device = await getById('devices', deviceId, 'id, is_active, status');
    const reportedUserId = body.user_id || null;
    let userId = reportedUserId;
    let finalDecision = 'denied';
    let reason;

    if (reportedUserId) {
        const { data: user, error: userError } = await supabase.from('access_users')
            .select('id, is_active').eq('id', reportedUserId).maybeSingle();
        if (userError) throw databaseError(userError, 'Không thể xác minh người dùng');
        if (!user) {
            userId = null;
            reason = 'unknown_user';
        } else if (!user.is_active) {
            reason = 'user_inactive';
        } else if (body.decision === 'denied') {
            reason = body.reason || 'device_denied';
        } else if (!device.is_active || device.status === 'maintenance') {
            reason = 'device_unavailable';
        } else {
            const now = new Date().toISOString();
            const { data: permissionRows, error: permissionError } = await supabase.from('access_permissions')
                .select('is_allowed').eq('user_id', user.id).eq('device_id', deviceId)
                .lte('valid_from', now).or(`valid_until.is.null,valid_until.gt.${now}`).limit(100);
            if (permissionError) throw databaseError(permissionError, 'Không thể xác minh quyền truy cập');
            if ((permissionRows || []).some((permission) => permission.is_allowed === false)) {
                reason = 'explicit_denial';
            } else if (!(permissionRows || []).some((permission) => permission.is_allowed === true)) {
                reason = 'no_valid_permission';
            } else {
                const { data: enrollment, error: enrollmentError } = await supabase.from('face_enrollments')
                    .select('id').eq('user_id', user.id).eq('device_id', deviceId).eq('status', 'completed').limit(1).maybeSingle();
                if (enrollmentError) throw databaseError(enrollmentError, 'Không thể xác minh đăng ký khuôn mặt');
                if (!enrollment) reason = 'no_completed_enrollment';
                else {
                    finalDecision = 'allowed';
                    reason = null;
                }
            }
        }
    } else {
        reason = body.reason || 'unknown_user';
    }

    const occurredAt = body.occurred_at ? new Date(body.occurred_at) : new Date();
    if (Number.isNaN(occurredAt.getTime()) || Math.abs(Date.now() - occurredAt.getTime()) > 5 * 60_000) {
        throw createHttpError(400, 'occurred_at không hợp lệ hoặc đã quá hạn');
    }

    const event = {
        user_id: userId,
        device_id: deviceId,
        decision: finalDecision,
        confidence: body.confidence ?? null,
        event_source: 'face',
        reason: reason ? String(reason).slice(0, 255) : null,
        idempotency_key: idempotencyKey,
        occurred_at: occurredAt.toISOString()
    };
    const { data, error } = await supabase.from('access_events').insert(event).select('*').single();
    if (error?.code === '23505') {
        const { data: existing, error: existingError } = await supabase.from('access_events')
            .select('*').eq('idempotency_key', idempotencyKey).eq('device_id', deviceId).maybeSingle();
        if (existingError) throw databaseError(existingError);
        if (existing) return { event: existing, duplicate: true };
    }
    if (error) throw databaseError(error, 'Không thể ghi nhận sự kiện truy cập');
    return { event: data, duplicate: false };
};

const recordEnrollmentResult = async (deviceId, enrollmentId, status) => {
    const { data, error } = await supabase.rpc('complete_face_enrollment', {
        p_enrollment_id: enrollmentId,
        p_device_id: deviceId,
        p_status: status
    });
    if (error) throw databaseError(error, 'Không thể lưu kết quả đăng ký');
    return data;
};

module.exports = { heartbeat, bumpPermissionVersion, syncDevice, listPendingCommands, acknowledgeCommand, recordAccessEvent, recordEnrollmentResult };
