const crypto = require('crypto');

const assignRequestId = (req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
};

module.exports = { assignRequestId };
