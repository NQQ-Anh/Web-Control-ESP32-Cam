const { supabase, databaseError, getById } = require('./resource.service');
const { escapePostgrestSearch } = require('../utils/http');

const permissionSelect = '*, access_users(id, employee_code, full_name), devices(id, device_code, device_name, status)';

const listPermissions = async (query, pagination) => {
    let request = supabase.from('access_permissions').select(permissionSelect, { count: 'exact' });
    for (const field of ['user_id', 'device_id', 'is_allowed']) {
        if (query[field] !== undefined && query[field] !== '') request = request.eq(field, query[field]);
    }

    if (typeof query.q === 'string' && query.q.trim()) {
        const term = escapePostgrestSearch(query.q);
        const [users, devices] = await Promise.all([
            supabase.from('access_users').select('id').or(`full_name.ilike.%${term}%,employee_code.ilike.%${term}%,email.ilike.%${term}%`).limit(500),
            supabase.from('devices').select('id').or(`device_name.ilike.%${term}%,device_code.ilike.%${term}%,location.ilike.%${term}%`).limit(500)
        ]);
        if (users.error) throw databaseError(users.error);
        if (devices.error) throw databaseError(devices.error);
        const clauses = [`reason.ilike.%${term}%`];
        if (users.data?.length) clauses.push(`user_id.in.(${users.data.map((row) => row.id).join(',')})`);
        if (devices.data?.length) clauses.push(`device_id.in.(${devices.data.map((row) => row.id).join(',')})`);
        if (clauses.length === 1 && !users.data?.length && !devices.data?.length) {
            request = request.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
            request = request.or(clauses.join(','));
        }
    }

    const { data, error, count } = await request.order('created_at', { ascending: false }).range(pagination.from, pagination.to);
    if (error) throw databaseError(error, 'Không thể tải quyền truy cập');
    return { items: data || [], pagination: { page: pagination.page, limit: pagination.limit, total: count || 0 } };
};

const createPermission = async (payload, actorId) => {
    const values = {
        p_id: null,
        p_user_id: payload.user_id,
        p_device_id: payload.device_id,
        p_valid_from: payload.valid_from || new Date().toISOString(),
        p_valid_until: payload.valid_until ?? null,
        p_is_allowed: payload.is_allowed ?? true,
        p_reason: payload.reason ?? null,
        p_actor_id: actorId
    };
    const { data, error } = await supabase.rpc('save_access_permission', values);
    if (error) throw databaseError(error, 'Không thể tạo quyền truy cập');
    return getById('access_permissions', data.id, permissionSelect);
};

const updatePermission = async (id, payload, actorId) => {
    const previous = await getById('access_permissions', id, 'id, user_id, device_id, valid_from, valid_until, is_allowed, reason');
    const { data, error } = await supabase.rpc('save_access_permission', {
        p_id: id,
        p_user_id: payload.user_id ?? previous.user_id,
        p_device_id: payload.device_id ?? previous.device_id,
        p_valid_from: payload.valid_from ?? previous.valid_from,
        p_valid_until: payload.valid_until === undefined ? previous.valid_until : payload.valid_until,
        p_is_allowed: payload.is_allowed ?? previous.is_allowed,
        p_reason: payload.reason === undefined ? previous.reason : payload.reason,
        p_actor_id: actorId
    });
    if (error) throw databaseError(error, 'Không thể cập nhật quyền truy cập');
    return getById('access_permissions', data.id, permissionSelect);
};

const setPermissionStatus = async (id, isAllowed, actorId) => updatePermission(id, { is_allowed: isAllowed }, actorId);

const revokePermission = async (id, actorId) => {
    return updatePermission(id, { is_allowed: false }, actorId);
};

module.exports = { listPermissions, getPermission: (id) => getById('access_permissions', id, permissionSelect), createPermission, updatePermission, setPermissionStatus, revokePermission };
