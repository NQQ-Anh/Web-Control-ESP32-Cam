const supabase = require('../config/supabase');
const { createHttpError, escapePostgrestSearch } = require('../utils/http');

const databaseError = (error, fallback = 'Không thể truy cập dữ liệu') => {
    if (error.code === 'PGRST202' || error.code === '42883') return createHttpError(503, 'Cơ sở dữ liệu chưa có migration API bắt buộc');
    if (error.code === 'P0002') return createHttpError(404, 'Không tìm thấy dữ liệu');
    if (error.code === '23505') return createHttpError(409, 'Dữ liệu đã tồn tại');
    if (error.code === '23503' || error.code === '22P02' || error.code === '23514' || error.code === '22023') return createHttpError(400, 'Dữ liệu tham chiếu hoặc định dạng không hợp lệ');
    if (error.code === 'PGRST116') return createHttpError(404, 'Không tìm thấy dữ liệu');
    if (error.code === '42501') return createHttpError(403, 'Không có quyền truy cập dữ liệu');
    return createHttpError(500, fallback);
};

const unwrap = (result, fallback) => {
    if (result.error) throw databaseError(result.error, fallback);
    return result.data;
};

const listResource = async ({ table, query, pagination, searchable = [], filters = {}, select = '*', orderBy = 'created_at' }) => {
    let request = supabase.from(table).select(select, { count: 'exact' });

    for (const [field, value] of Object.entries(filters)) {
        if (value !== undefined && value !== '') request = request.eq(field, value);
    }

    const search = typeof query.q === 'string' ? escapePostgrestSearch(query.q) : '';
    if (search) request = request.or(searchable.map((field) => `${field}.ilike.%${search}%`).join(','));

    request = request.order(orderBy, { ascending: false, nullsFirst: false }).range(pagination.from, pagination.to);
    const { data, error, count } = await request;
    if (error) throw databaseError(error);
    return { items: data || [], pagination: { page: pagination.page, limit: pagination.limit, total: count || 0 } };
};

const getById = async (table, id, select = '*') => {
    const { data, error } = await supabase.from(table).select(select).eq('id', id).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw createHttpError(404, 'Không tìm thấy dữ liệu');
    return data;
};

const insertOne = async (table, values, select = '*') => {
    const { data, error } = await supabase.from(table).insert(values).select(select).single();
    if (error) throw databaseError(error, 'Không thể tạo dữ liệu');
    return data;
};

const updateOne = async (table, id, values, select = '*') => {
    const { data, error } = await supabase.from(table).update(values).eq('id', id).select(select).maybeSingle();
    if (error) throw databaseError(error, 'Không thể cập nhật dữ liệu');
    if (!data) throw createHttpError(404, 'Không tìm thấy dữ liệu');
    return data;
};

module.exports = { supabase, databaseError, unwrap, listResource, getById, insertOne, updateOne };
