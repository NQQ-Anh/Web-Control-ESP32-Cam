const { supabase } = require('./resource.service');

const offlineAfterSeconds = Math.min(900, Math.max(30, Number.parseInt(process.env.DEVICE_OFFLINE_THRESHOLD_SECONDS, 10) || 120));
let timer;
let activeSweep = false;

const markStaleDevicesOffline = async () => {
    if (activeSweep) return;
    activeSweep = true;
    const now = new Date();
    const cutoff = new Date(now.getTime() - offlineAfterSeconds * 1000).toISOString();
    try {
        const { data, error } = await supabase.from('devices')
            .update({ status: 'offline', updated_at: now.toISOString() })
            .eq('is_active', true).eq('status', 'online').lt('last_seen_at', cutoff)
            .select('id');
        if (error) {
            console.error(JSON.stringify({ level: 'device-monitor-error', code: error.code || 'unknown' }));
        } else if (data?.length) {
            console.info(JSON.stringify({ level: 'device-monitor', action: 'marked_offline', count: data.length }));
        }
        const { data: expiredCommands, error: commandError } = await supabase.from('device_commands')
            .update({ status: 'expired' }).in('status', ['pending', 'sent']).lt('expires_at', now.toISOString()).select('id');
        if (commandError) {
            console.error(JSON.stringify({ level: 'command-monitor-error', code: commandError.code || 'unknown' }));
        } else if (expiredCommands?.length) {
            console.info(JSON.stringify({ level: 'command-monitor', action: 'marked_expired', count: expiredCommands.length }));
        }
    } catch (error) {
        console.error(JSON.stringify({ level: 'device-monitor-error', message: error.message }));
    } finally {
        activeSweep = false;
    }
};

const startDeviceMonitor = () => {
    if (timer) return () => clearInterval(timer);
    markStaleDevicesOffline();
    timer = setInterval(markStaleDevicesOffline, 30_000);
    timer.unref?.();
    return () => {
        clearInterval(timer);
        timer = undefined;
    };
};

module.exports = { startDeviceMonitor, markStaleDevicesOffline, offlineAfterSeconds };
