const { supabase, databaseError, listResource, getById } = require('./resource.service');

const enrollmentSelect = 'id, user_id, device_id, status, enrolled_at, revoked_at, created_at, updated_at, access_users(id, employee_code, full_name), devices(id, device_code, device_name)';

const listEnrollments = (query, pagination) => listResource({
    table: 'face_enrollments', query, pagination,
    searchable: [],
    filters: { status: query.status, user_id: query.user_id, device_id: query.device_id },
    select: enrollmentSelect,
    orderBy: 'created_at'
});

const createEnrollment = async ({ userId, deviceId, actorId }) => {
    const { data, error } = await supabase.rpc('request_face_enrollment', {
        p_user_id: userId,
        p_device_id: deviceId,
        p_actor_id: actorId
    });
    if (error) throw databaseError(error, 'Không thể tạo yêu cầu enrollment');
    return getById('face_enrollments', data.id, enrollmentSelect);
};

const revokeEnrollment = async (id, actorId) => {
    const { data, error } = await supabase.rpc('revoke_face_enrollment', { p_enrollment_id: id, p_actor_id: actorId });
    if (error) throw databaseError(error, 'Không thể thu hồi enrollment');
    return getById('face_enrollments', data.id, enrollmentSelect);
};

module.exports = { listEnrollments, getEnrollment: (id) => getById('face_enrollments', id, enrollmentSelect), createEnrollment, revokeEnrollment };
