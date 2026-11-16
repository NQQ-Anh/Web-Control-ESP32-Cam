const { supabase, databaseError } = require('./resource.service');
const { createHttpError } = require('../utils/http');

const timeZone = process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh';

const timezoneParts = (date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
}).formatToParts(date).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));

const timezoneOffsetMs = (date) => {
    const formatted = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00';
    const match = formatted.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return (match[1] === '+' ? 1 : -1) * minutes * 60_000;
};

const startOfLocalDay = (date) => {
    const parts = timezoneParts(date);
    const localMidnightAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    const offset = timezoneOffsetMs(date);
    return new Date(localMidnightAsUtc - offset);
};

const countRows = async (table, filters = {}) => {
    let request = supabase.from(table).select('id', { count: 'exact', head: true });
    for (const [field, value] of Object.entries(filters)) request = request.eq(field, value);
    const { count, error } = await request;
    if (error) throw databaseError(error, 'Không thể tổng hợp dữ liệu dashboard');
    return count || 0;
};

const summary = async () => {
    const dayStart = startOfLocalDay(new Date()).toISOString();
    const [users, activeUsers, completedEnrollments, devices, onlineDevices, offlineDevices, accessToday, allowedToday, deniedToday, webUnlocksToday] = await Promise.all([
        countRows('access_users'),
        countRows('access_users', { is_active: true }),
        countRows('face_enrollments', { status: 'completed' }),
        countRows('devices'),
        countRows('devices', { status: 'online', is_active: true }),
        countRows('devices', { status: 'offline', is_active: true }),
        supabase.from('access_events').select('id', { count: 'exact', head: true }).gte('occurred_at', dayStart),
        supabase.from('access_events').select('id', { count: 'exact', head: true }).eq('decision', 'allowed').gte('occurred_at', dayStart),
        supabase.from('access_events').select('id', { count: 'exact', head: true }).eq('decision', 'denied').gte('occurred_at', dayStart),
        supabase.from('device_commands').select('id', { count: 'exact', head: true })
            .eq('command', 'unlock').eq('status', 'acknowledged').gte('requested_at', dayStart)
    ]);
    for (const result of [accessToday, allowedToday, deniedToday, webUnlocksToday]) if (result.error) throw databaseError(result.error, 'Không thể tổng hợp sự kiện truy cập');
    return {
        users: { total: users, active: activeUsers },
        enrollments: { completed: completedEnrollments },
        devices: { total: devices, online: onlineDevices, offline: offlineDevices },
        access_today: { total: accessToday.count || 0, allowed: allowedToday.count || 0, denied: deniedToday.count || 0 },
        web_unlocks_today: webUnlocksToday.count || 0,
        date: timezoneParts(new Date()).year + '-' + timezoneParts(new Date()).month + '-' + timezoneParts(new Date()).day,
        time_zone: timeZone
    };
};

const accessStatistics = async () => {
    const now = new Date();
    const localToday = startOfLocalDay(now);
    const start = new Date(localToday.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error, count } = await supabase.from('access_events').select('decision, occurred_at', { count: 'exact' })
        .gte('occurred_at', start).order('occurred_at', { ascending: true }).limit(10_000);
    if (error) throw databaseError(error, 'Không thể tải thống kê truy cập');
    if ((count || 0) > 10_000) throw createHttpError(413, 'Khoảng dữ liệu thống kê vượt quá giới hạn; hãy dùng bộ lọc ngày');

    const days = new Map();
    for (let offset = 0; offset < 7; offset += 1) {
        const date = new Date(localToday.getTime() - (6 - offset) * 86_400_000);
        const parts = timezoneParts(date);
        const key = `${parts.year}-${parts.month}-${parts.day}`;
        days.set(key, { date: key, allowed: 0, denied: 0, total: 0 });
    }
    for (const event of data || []) {
        const parts = timezoneParts(new Date(event.occurred_at));
        const key = `${parts.year}-${parts.month}-${parts.day}`;
        const bucket = days.get(key);
        if (bucket && ['allowed', 'denied'].includes(event.decision)) {
            bucket[event.decision] += 1;
            bucket.total += 1;
        }
    }
    return [...days.values()];
};

const recentEvents = async (limit = 10) => {
    const { data, error } = await supabase.from('access_events')
        .select('id, user_id, device_id, decision, confidence, reason, occurred_at, access_users(id, employee_code, full_name), devices(id, device_code, device_name)')
        .order('occurred_at', { ascending: false }).limit(limit);
    if (error) throw databaseError(error, 'Không thể tải sự kiện gần đây');
    return data || [];
};

const deviceStatistics = async () => {
    const { data, error } = await supabase.from('devices').select('id, device_code, device_name, location, status, door_state, door_state_updated_at, last_seen_at, is_active')
        .eq('is_active', true).order('last_seen_at', { ascending: false, nullsFirst: false }).limit(2000);
    if (error) throw databaseError(error, 'Không thể tải trạng thái thiết bị');
    const counts = { online: 0, offline: 0, maintenance: 0 };
    const doorStateCounts = { locked: 0, unlocked: 0, unknown: 0 };
    for (const device of data || []) {
        if (Object.prototype.hasOwnProperty.call(counts, device.status)) counts[device.status] += 1;
        const doorState = Object.prototype.hasOwnProperty.call(doorStateCounts, device.door_state) ? device.door_state : 'unknown';
        doorStateCounts[doorState] += 1;
    }
    return { counts, door_state_counts: doorStateCounts, offline_devices: (data || []).filter((device) => device.status === 'offline') };
};

module.exports = { summary, accessStatistics, recentEvents, deviceStatistics };
