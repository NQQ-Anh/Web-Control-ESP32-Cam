const createSupabaseAuthClient = require('../config/supabaseAuth');
const supabase = require('../config/supabase');
const { recordAudit } = require('./audit.service');

const createAuthError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const register = async ({ email, password, full_name }) => {
    const authClient = createSupabaseAuthClient();
    const options = { data: { full_name } };
    if (process.env.AUTH_SIGNUP_REDIRECT_URL) options.emailRedirectTo = process.env.AUTH_SIGNUP_REDIRECT_URL;

    const { data, error } = await authClient.auth.signUp({ email, password, options });
    if (error) {
        if (['email_exists', 'user_already_exists'].includes(error.code)) {
            return { user: null, session: null, requires_email_confirmation: true };
        }
        if (error.code === 'weak_password') throw createAuthError('Mật khẩu chưa đáp ứng yêu cầu bảo mật của Supabase', 400);
        if (['email_address_invalid', 'validation_failed'].includes(error.code)) throw createAuthError('Email hoặc thông tin đăng ký không hợp lệ', 400);
        if (['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code)) {
            throw createAuthError('Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.', 429);
        }
        if (error.code === 'signup_disabled') throw createAuthError('Đăng ký mới đang bị tắt trong cấu hình Supabase Auth', 503);
        throw createAuthError('Không thể tạo tài khoản lúc này. Hãy kiểm tra email và thử lại.', 503);
    }

    if (!data.user) throw createAuthError('Không thể tạo tài khoản lúc này', 503);
    // Supabase may return an obfuscated user for an existing confirmed email.
    // Do not create a profile or reveal whether that email is already registered.
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { user: null, session: null, requires_email_confirmation: true };
    }

    const { data: insertedProfile, error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        full_name,
        role: 'viewer',
        is_active: true,
        updated_at: new Date().toISOString()
    }).select('id, full_name, role, is_active').maybeSingle();

    let profile = insertedProfile;
    if (profileError?.code === '23505') {
        // A database signup trigger may already have created the profile. Never
        // overwrite a pre-existing role or reactivate a disabled account.
        const { data: existingProfile, error: readError } = await supabase.from('profiles')
            .select('id, full_name, role, is_active').eq('id', data.user.id).maybeSingle();
        if (readError) throw createAuthError('Không thể xác minh hồ sơ tài khoản', 503);
        if (existingProfile?.role === 'viewer' && existingProfile.is_active === true) profile = existingProfile;
        else {
            if (data.session) await revokeSession(data.session.access_token).catch(() => {});
            return { user: null, session: null, requires_email_confirmation: true };
        }
    } else if (profileError || !profile) {
        throw createAuthError('Không thể tạo hồ sơ tài khoản. Hãy thử đăng ký lại sau.', 503);
    }

    await recordAudit({ actorId: profile.id, action: 'auth.self_register', resourceType: 'profile', resourceId: profile.id });
    return {
        user: { ...profile, email: data.user.email },
        session: data.session || null,
        requires_email_confirmation: !data.session
    };
};

const login = async (email, password) => {
    const { data, error } = await createSupabaseAuthClient().auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        throw createAuthError('Email hoặc mật khẩu không chính xác', 401);
    }

    if (!data.user || !data.session) {
        throw createAuthError('Không thể tạo phiên đăng nhập', 502);
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active')
        .eq('id', data.user.id)
        .maybeSingle();

    if (profileError) {
        throw createAuthError('Không thể xác minh quyền tài khoản', 503);
    }

    if (!profile || profile.is_active !== true || !['admin', 'operator', 'viewer'].includes(profile.role)) {
        await revokeSession(data.session.access_token).catch(() => {});
        throw createAuthError('Tài khoản không được phép truy cập hệ thống', 403);
    }

    return {
        user: profile,
        session: data.session
    };
};

const refresh = async (refreshToken) => {
    const { data, error } = await createSupabaseAuthClient().auth.refreshSession({
        refresh_token: refreshToken
    });

    if (error || !data.session) {
        throw createAuthError('Refresh token không hợp lệ hoặc đã hết hạn', 401);
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active')
        .eq('id', data.user.id)
        .maybeSingle();

    if (profileError) throw createAuthError('Không thể xác minh quyền tài khoản', 503);
    if (!profile || profile.is_active !== true || !['admin', 'operator', 'viewer'].includes(profile.role)) {
        await revokeSession(data.session.access_token).catch(() => {});
        throw createAuthError('Tài khoản không được phép truy cập hệ thống', 403);
    }

    return { user: profile, session: data.session };
};

const revokeSession = async (accessToken) => {
    const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/logout`, {
        method: 'POST',
        headers: {
            apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) throw createAuthError('Không thể thu hồi phiên đăng nhập', 502);
};

const logout = async (accessToken) => revokeSession(accessToken);

const updateProfile = async (userId, fullName) => {
    const { data, error } = await supabase.from('profiles')
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq('id', userId).select('id, full_name, role, is_active, created_at, updated_at').maybeSingle();
    if (error) throw createAuthError('Không thể cập nhật thông tin cá nhân', 503);
    if (!data) throw createAuthError('Không tìm thấy hồ sơ tài khoản', 404);
    await recordAudit({ actorId: userId, action: 'profile.update_self', resourceType: 'profile', resourceId: userId });
    return data;
};

const changePassword = async (accessToken, password) => {
    const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
        method: 'PUT',
        headers: {
            apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
    });
    if (!response.ok) throw createAuthError('Không thể đổi mật khẩu. Hãy đăng nhập lại nếu phiên đã hết hạn.', 400);
};

const acceptInvite = async (tokenHash, password) => {
    const authClient = createSupabaseAuthClient();
    const { data: inviteData, error: inviteError } = await authClient.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
    if (inviteError || !inviteData.user || !inviteData.session) throw createAuthError('Liên kết mời không hợp lệ hoặc đã hết hạn', 400);

    const { data: profile, error: profileError } = await supabase.from('profiles')
        .select('id, full_name, role, is_active').eq('id', inviteData.user.id).maybeSingle();
    if (profileError) throw createAuthError('Không thể xác minh quyền tài khoản', 503);
    if (!profile || profile.is_active !== true || !['admin', 'operator', 'viewer'].includes(profile.role)) {
        await revokeSession(inviteData.session.access_token).catch(() => {});
        throw createAuthError('Tài khoản không được phép truy cập hệ thống', 403);
    }

    const { error: passwordError } = await authClient.auth.updateUser({ password });
    if (passwordError) throw createAuthError('Không thể thiết lập mật khẩu. Hãy yêu cầu quản trị viên gửi lời mời mới.', 400);
    const { data: sessionData } = await authClient.auth.getSession();
    await recordAudit({ actorId: profile.id, action: 'admin.invite.accept', resourceType: 'profile', resourceId: profile.id });
    return { user: { ...profile, email: inviteData.user.email }, session: sessionData.session };
};

module.exports = {
    register,
    login,
    refresh,
    logout,
    updateProfile,
    changePassword,
    acceptInvite
};
