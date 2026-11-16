const { supabase, databaseError } = require('./resource.service');
const { createHttpError, escapePostgrestSearch } = require('../utils/http');
const { mergeHistory } = require('../utils/history');

const MAX_HISTORY_SCAN = 10_000;
const faceEventSelect = 'id, user_id, device_id, decision, confidence, event_source, reason, occurred_at, access_users(id, employee_code, full_name), devices(id, device_code, device_name)';
const commandSelect = 'id, device_id, command, status, requested_by, requested_at, expires_at, executed_at, response, error_message, devices(id, device_code, device_name), profiles(id, full_name)';
const commandStatuses = new Set(['pending', 'sent', 'acknowledged', 'failed', 'expired']);

const fetchTopRows = async (buildRequest, targetRows) => {
    const rows = [];
    let count = 0;
    let offset = 0;
    while (rows.length < targetRows) {
        const chunkSize = Math.min(1000, targetRows - rows.length);
        const { data, count: reportedCount, error } = await buildRequest(offset === 0).range(offset, offset + chunkSize - 1);
        if (error) return { data: null, count: null, error };
        if (offset === 0) count = reportedCount || 0;
        rows.push(...(data || []));
        if (!data?.length || data.length < chunkSize) break;
        offset += data.length;
    }
    return { data: rows, count, error: null };
};

const listHistory = async (filters, pagination) => {
    const requestedRows = pagination.to + 1;
    if (requestedRows > MAX_HISTORY_SCAN) {
        throw createHttpError(413, `Lịch sử chỉ cho phép xem tối đa ${MAX_HISTORY_SCAN} bản ghi trong một lần lọc`);
    }

    const includeFaceEvents = filters.event_type !== 'door_command'
        && (!filters.result || ['allowed', 'denied'].includes(filters.result));
    const includeCommands = filters.event_type !== 'face'
        && !filters.user_id
        && (!filters.result || commandStatuses.has(filters.result));

    let eventsRequest = Promise.resolve({ data: [], count: 0, error: null });
    if (includeFaceEvents) {
        eventsRequest = fetchTopRows((withCount) => {
            let request = supabase.from('access_events').select(faceEventSelect, withCount ? { count: 'exact' } : undefined)
                .order('occurred_at', { ascending: false });
            if (filters.user_id) request = request.eq('user_id', filters.user_id);
            if (filters.device_id) request = request.eq('device_id', filters.device_id);
            if (filters.result) request = request.eq('decision', filters.result);
            if (filters.from) request = request.gte('occurred_at', filters.from);
            if (filters.to) request = request.lte('occurred_at', filters.to);
            if (filters.q) {
                const term = escapePostgrestSearch(filters.q);
                request = request.or(`reason.ilike.%${term}%,event_source.ilike.%${term}%`);
            }
            return request;
        }, requestedRows);
    }

    let commandsRequest = Promise.resolve({ data: [], count: 0, error: null });
    if (includeCommands) {
        commandsRequest = fetchTopRows((withCount) => {
            let request = supabase.from('device_commands').select(commandSelect, withCount ? { count: 'exact' } : undefined)
                .order('requested_at', { ascending: false });
            if (filters.device_id) request = request.eq('device_id', filters.device_id);
            if (filters.result) request = request.eq('status', filters.result);
            if (filters.from) request = request.gte('requested_at', filters.from);
            if (filters.to) request = request.lte('requested_at', filters.to);
            if (filters.q) {
                const term = escapePostgrestSearch(filters.q);
                const knownCommand = ['unlock', 'lock', 'sync_permissions', 'restart'].includes(filters.q.toLowerCase())
                    ? `command.eq.${filters.q.toLowerCase()},`
                    : '';
                request = request.or(`${knownCommand}error_message.ilike.%${term}%`);
            }
            return request;
        }, requestedRows);
    }

    const [eventsResult, commandsResult] = await Promise.all([eventsRequest, commandsRequest]);
    if (eventsResult.error) throw databaseError(eventsResult.error, 'Không thể tải sự kiện khuôn mặt');
    if (commandsResult.error) throw databaseError(commandsResult.error, 'Không thể tải kết quả lệnh cửa');

    const merged = mergeHistory(eventsResult.data, commandsResult.data, pagination);
    return {
        items: merged.items,
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: (eventsResult.count || 0) + (commandsResult.count || 0),
        },
    };
};

const exportHistory = async (filters) => {
    const result = await listHistory(filters, { page: 1, limit: MAX_HISTORY_SCAN, from: 0, to: MAX_HISTORY_SCAN - 1 });
    if (result.pagination.total > MAX_HISTORY_SCAN) {
        throw createHttpError(413, `Chỉ có thể xuất tối đa ${MAX_HISTORY_SCAN} dòng lịch sử mỗi lần`);
    }
    return result.items;
};

module.exports = { listHistory, exportHistory };
