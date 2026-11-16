const createHttpError = (statusCode, message, details) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (details) error.details = details;
    return error;
};

const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

const parsePagination = (query) => {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
    return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
};

const assertUuid = (value, field = 'id') => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw createHttpError(400, `${field} không hợp lệ`);
    }
    return value;
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const escapePostgrestSearch = (value) => String(value)
    .trim()
    .slice(0, 100)
    .replace(/[\\%_(),.*]/g, (character) => `\\${character}`);

module.exports = { createHttpError, asyncHandler, parsePagination, assertUuid, isPlainObject, escapePostgrestSearch };
