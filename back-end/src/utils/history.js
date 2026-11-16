const normalizeFaceEvent = (event) => ({
    id: event.id,
    record_type: 'access_event',
    user_id: event.user_id,
    access_users: event.access_users,
    device_id: event.device_id,
    devices: event.devices,
    event_type: 'FACE_ACCESS_EVENT',
    action: 'face_access',
    source: 'ESP32-CAM',
    event_source: event.event_source,
    decision: event.decision,
    result: event.decision,
    confidence: event.confidence,
    reason: event.reason,
    occurred_at: event.occurred_at,
    requested_at: null,
    executed_at: null,
    requested_by: null,
    actor_name: event.access_users?.full_name || 'Không nhận diện',
});

const normalizeDeviceCommand = (command) => ({
    id: command.id,
    record_type: 'device_command',
    user_id: null,
    access_users: null,
    device_id: command.device_id,
    devices: command.devices,
    event_type: 'DOOR_COMMAND',
    action: command.command,
    command: command.command,
    source: 'Web',
    event_source: 'web',
    decision: command.status,
    result: command.status,
    confidence: null,
    reason: command.error_message,
    occurred_at: command.requested_at,
    requested_at: command.requested_at,
    executed_at: command.executed_at,
    requested_by: command.requested_by,
    actor_name: command.profiles?.full_name || 'Người vận hành Web',
    error_message: command.error_message,
    response: command.response,
    expires_at: command.expires_at,
});

const mergeHistory = (faceEvents, deviceCommands, pagination) => {
    const rows = [
        ...(faceEvents || []).map(normalizeFaceEvent),
        ...(deviceCommands || []).map(normalizeDeviceCommand),
    ].sort((left, right) => {
        const timeDifference = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
        return timeDifference || left.id.localeCompare(right.id);
    });

    return {
        items: rows.slice(pagination.from, pagination.to + 1),
        total: rows.length,
    };
};

module.exports = { normalizeFaceEvent, normalizeDeviceCommand, mergeHistory };
