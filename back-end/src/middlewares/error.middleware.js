const notFound = (req, res, next) => {
    const error = new Error(`API route not found: ${req.method} ${req.path}`);
    error.statusCode = 404;
    return next(error);
};

const errorHandler = (error, req, res, _next) => {
    const candidateStatus = error.statusCode || error.status;
    const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500;
    const requestId = req.id || 'unknown';

    if (statusCode >= 500) {
        console.error(JSON.stringify({
            level: 'error',
            requestId,
            method: req.method,
            path: req.path,
            error: error.message
        }));
    }

    return res.status(statusCode).json({
        success: false,
        message: statusCode >= 500 ? 'Đã xảy ra lỗi máy chủ' : error.message,
        request_id: requestId
    });
};

module.exports = { notFound, errorHandler };
