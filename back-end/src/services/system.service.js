const { supabase, databaseError } = require('./resource.service');

const secondsFromEnv = (name, fallback, minimum, maximum) => Math.min(
    maximum,
    Math.max(minimum, Number.parseInt(process.env[name], 10) || fallback)
);

const getSystemStatus = async () => {
    const startedAt = Date.now();
    const { error } = await supabase.from('devices').select('id').limit(1);
    if (error) throw databaseError(error, 'Không thể kiểm tra kết nối Supabase');

    return {
        checked_at: new Date().toISOString(),
        backend: {
            status: 'online',
            node_version: process.versions.node,
            uptime_seconds: Math.floor(process.uptime())
        },
        database: { status: 'connected', latency_ms: Date.now() - startedAt },
        device: {
            offline_after_seconds: secondsFromEnv('DEVICE_OFFLINE_THRESHOLD_SECONDS', 120, 30, 900),
            offline_cache_max_age_seconds: secondsFromEnv('DEVICE_OFFLINE_MAX_AGE_SECONDS', 300, 30, 900),
            heartbeat_monitor_interval_seconds: 30,
            door_command_timeout_seconds: 30,
            other_command_timeout_seconds: 120,
            device_access_token_ttl_seconds: 300,
            device_https_required: process.env.NODE_ENV === 'production'
        },
        updates: { mode: 'api-polling', recommended_interval_seconds: 15 }
    };
};

module.exports = { getSystemStatus };
