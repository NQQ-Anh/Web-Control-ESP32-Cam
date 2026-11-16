const { supabase, databaseError } = require('./resource.service');
const { recordAudit } = require('./audit.service');
const { createHttpError } = require('../utils/http');

const roles = new Set(['admin', 'operator', 'viewer']);
const profileSelect = 'id, full_name, role, is_active, created_at, updated_at';

const authEmail = async (id) => {
    const { data, error } = await supabase.auth.admin.getUserById(id);
    if (error) throw createHttpError(503, 'Không thể đọc thông tin tài khoản xác thực');
    return data.user?.email || null;
};

const listAdmins = async ({ page, limit, role, is_active, q }) => {
    let query = supabase.from('profiles').select(profileSelect, { count: 'exact' });
    if (role) query = query.eq('role', role);
    if (is_active !== undefined) query = query.eq('is_active', is_active);
    if (q) query = query.ilike('full_name', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) throw databaseError(error, 'Không thể tải tài khoản quản trị');
    const items = await Promise.all((data || []).map(async (profile) => ({ ...profile, email: await authEmail(profile.id) })));
    return { items, pagination: { page, limit, total: count || 0 } };
};

const getAdmin = async (id) => {
    const { data, error } = await supabase.from('profiles').select(profileSelect).eq('id', id).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw createHttpError(404, 'Không tìm thấy tài khoản quản trị');
    return { ...data, email: await authEmail(id) };
};

const createAdmin = async ({ email, full_name, role }, actorId) => {
    if (!roles.has(role)) throw createHttpError(400, 'Vai trò không hợp lệ');
    const inviteOptions = { data: { full_name } };
    if (process.env.AUTH_INVITE_REDIRECT_URL) inviteOptions.redirectTo = process.env.AUTH_INVITE_REDIRECT_URL;
    const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(email, inviteOptions);
    if (authError || !authData.user) {
        if (authError?.code === 'email_exists') throw createHttpError(409, 'Email đã được sử dụng');
        throw createHttpError(503, 'Không thể gửi lời mời xác thực. Kiểm tra cấu hình email Supabase.');
    }

    const { data: profile, error } = await supabase.from('profiles').upsert({
        id: authData.user.id,
        full_name,
        role,
        is_active: true,
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' }).select(profileSelect).single();
    if (error) {
        await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
        throw databaseError(error, 'Không thể tạo hồ sơ quản trị');
    }
    await recordAudit({ actorId, action: 'admin.create', resourceType: 'profile', resourceId: profile.id, metadata: { role } });
    return { ...profile, email: authData.user.email };
};

const updateAdmin = async (id, payload, actorId) => {
    const existing = await getAdmin(id);
    if (payload.role && !roles.has(payload.role)) throw createHttpError(400, 'Vai trò không hợp lệ');
    if (id === actorId && payload.role && payload.role !== 'admin') {
        const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true);
        if (error) throw databaseError(error);
        if ((count || 0) <= 1) throw createHttpError(409, 'Không thể hạ quyền quản trị viên đang duy nhất hoạt động');
    }

    const profileValues = {};
    if (payload.full_name !== undefined) profileValues.full_name = payload.full_name;
    if (payload.role !== undefined) profileValues.role = payload.role;
    if (Object.keys(profileValues).length) profileValues.updated_at = new Date().toISOString();

    let email = existing.email;
    if (payload.email !== undefined && payload.email !== existing.email) {
        const { data, error } = await supabase.auth.admin.updateUserById(id, { email: payload.email });
        if (error) throw createHttpError(error.code === 'email_exists' ? 409 : 503, error.code === 'email_exists' ? 'Email đã được sử dụng' : 'Không thể cập nhật email tài khoản');
        email = data.user?.email || payload.email;
    }

    let profile = existing;
    if (Object.keys(profileValues).length) {
        const { data, error } = await supabase.from('profiles').update(profileValues).eq('id', id).select(profileSelect).maybeSingle();
        if (error) throw databaseError(error, 'Không thể cập nhật tài khoản quản trị');
        if (!data) throw createHttpError(404, 'Không tìm thấy tài khoản quản trị');
        profile = data;
    }
    await recordAudit({ actorId, action: 'admin.update', resourceType: 'profile', resourceId: id, metadata: { fields: Object.keys(payload).filter((field) => field !== 'email') } });
    return { ...profile, email };
};

const setAdminStatus = async (id, isActive, actorId) => {
    const existing = await getAdmin(id);
    if (!isActive && id === actorId) throw createHttpError(409, 'Không thể vô hiệu hóa tài khoản đang đăng nhập');
    if (!isActive && existing.role === 'admin') {
        const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true);
        if (error) throw databaseError(error);
        if ((count || 0) <= 1) throw createHttpError(409, 'Phải có ít nhất một quản trị viên đang hoạt động');
    }

    const { error: authError } = await supabase.auth.admin.updateUserById(id, { ban_duration: isActive ? 'none' : '876000h' });
    if (authError) throw createHttpError(503, 'Không thể cập nhật trạng thái xác thực tài khoản');
    const { data, error } = await supabase.from('profiles').update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id).select(profileSelect).maybeSingle();
    if (error || !data) {
        await supabase.auth.admin.updateUserById(id, { ban_duration: existing.is_active ? 'none' : '876000h' }).catch(() => {});
        if (error) throw databaseError(error, 'Không thể cập nhật trạng thái tài khoản');
        throw createHttpError(404, 'Không tìm thấy tài khoản quản trị');
    }
    await recordAudit({ actorId, action: isActive ? 'admin.activate' : 'admin.deactivate', resourceType: 'profile', resourceId: id });
    return { ...data, email: existing.email };
};

module.exports = { listAdmins, getAdmin, createAdmin, updateAdmin, setAdminStatus };
