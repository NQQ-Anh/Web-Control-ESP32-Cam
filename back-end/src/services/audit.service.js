const { supabase } = require('./resource.service');

const recordAudit = async ({ actorId, action, resourceType, resourceId = null, metadata = {} }) => {
    const entry = {
        actor_id: actorId || null,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        created_at: new Date().toISOString()
    };

    const { error } = await supabase.from('audit_logs').insert(entry);
    if (error) {
        // The migration is included in the project; until applied, preserve a
        // structured server log instead of falsely reporting durable auditing.
        console.error(JSON.stringify({ level: 'audit-fallback', ...entry, databaseCode: error.code }));
    }
};

module.exports = { recordAudit };
