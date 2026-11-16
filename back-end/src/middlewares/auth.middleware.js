const createSupabaseAuthClient = require('../config/supabaseAuth');
const supabase = require('../config/supabase');

const validRoles = new Set(['admin', 'operator', 'viewer']);

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.get('authorization');

        if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) {
            return res.status(401).json({
                success: false,
                message: 'Bạn chưa cung cấp Access Token'
            });
        }

        const token = authHeader.slice(authHeader.indexOf(' ') + 1).trim();

        // Xác minh token với Supabase Auth.
        const {
            data: { user },
            error: authError
        } = await createSupabaseAuthClient().auth.getUser(token);

        if (authError || !user) {
            return res.status(401).json({
                success: false,
                message: 'Access Token không hợp lệ hoặc đã hết hạn'
            });
        }

        // Chỉ truy vấn profile sau khi đã xác minh danh tính.
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, role, is_active')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || profile.is_active !== true || !validRoles.has(profile.role)) {
            return res.status(403).json({
                success: false,
                message: 'Tài khoản không có quyền truy cập'
            });
        }

        req.accessToken = token;
        req.user = Object.freeze({
            id: user.id,
            email: user.email,
            full_name: profile.full_name,
            role: profile.role
        });

        return next();

    } catch (error) {
        return next(error);
    }
};

module.exports = authenticate;
