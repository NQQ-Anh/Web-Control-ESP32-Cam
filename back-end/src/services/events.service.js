const { supabase, databaseError } = require('./resource.service');
const { createHttpError, escapePostgrestSearch } = require('../utils/http');

const eventSelect = 'id, user_id, device_id, decision, confidence, event_source, reason, occurred_at, created_at, access_users(id, employee_code, full_name), devices(id, device_code, device_name)';

const eventQuery = (query) => {
    let request = supabase.from('access_events').select(eventSelect, { count: 'exact' });
    for (const field of ['user_id', 'device_id', 'decision']) if (query[field] !== undefined) request = request.eq(field, query[field]);
    if (query.from) request = request.gte('occurred_at', query.from);
    if (query.to) request = request.lte('occurred_at', query.to);
    if (query.q) request = request.or(`reason.ilike.%${escapePostgrestSearch(query.q)}%,event_source.ilike.%${escapePostgrestSearch(query.q)}%`);
    return request;
};

const listEvents = async (query, pagination) => {
    const { data, error, count } = await eventQuery(query).order('occurred_at', { ascending: false }).range(pagination.from, pagination.to);
    if (error) throw databaseError(error, 'Không thể tải lịch sử truy cập');
    return { items: data || [], pagination: { page: pagination.page, limit: pagination.limit, total: count || 0 } };
};

const getEvent = async (id) => {
    const { data, error } = await supabase.from('access_events').select(eventSelect).eq('id', id).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw createHttpError(404, 'Không tìm thấy sự kiện truy cập');
    return data;
};

const exportEvents = async (query) => {
    const { data, error } = await eventQuery(query).order('occurred_at', { ascending: false }).limit(10_000);
    if (error) throw databaseError(error, 'Không thể xuất lịch sử truy cập');
    return data || [];
};

module.exports = { listEvents, getEvent, exportEvents };
