const { supabase, databaseError, listResource, getById, insertOne, updateOne } = require('./resource.service');
const { recordAudit } = require('./audit.service');

const listUsers = (query, pagination) => listResource({
    table: 'access_users', query, pagination,
    searchable: ['full_name', 'employee_code', 'email'],
    filters: { is_active: query.is_active },
    select: 'id, employee_code, full_name, email, phone, department, avatar_url, is_active, created_at, updated_at'
});

const createUser = async (payload, actorId) => {
    const user = await insertOne('access_users', { ...payload, created_by: actorId });
    await recordAudit({ actorId, action: 'access_user.create', resourceType: 'access_user', resourceId: user.id });
    return user;
};

const updateUser = async (id, payload, actorId) => {
    const user = await updateOne('access_users', id, { ...payload, updated_at: new Date().toISOString() });
    await recordAudit({ actorId, action: 'access_user.update', resourceType: 'access_user', resourceId: id, metadata: { fields: Object.keys(payload) } });
    return user;
};

const setUserStatus = async (id, isActive, actorId) => {
    const { data, error } = await supabase.rpc('set_access_user_active', {
        p_user_id: id,
        p_is_active: isActive,
        p_actor_id: actorId
    });
    if (error) throw databaseError(error, 'Không thể cập nhật trạng thái người dùng');
    return data;
};

module.exports = {
    listUsers,
    getUser: (id) => getById('access_users', id),
    createUser,
    updateUser,
    setUserStatus
};
