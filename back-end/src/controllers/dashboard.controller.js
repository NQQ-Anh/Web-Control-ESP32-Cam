const service = require('../services/dashboard.service');
const { createHttpError } = require('../utils/http');

const summary = async (_req, res) => res.json({ success: true, data: await service.summary() });
const accessStatistics = async (_req, res) => res.json({ success: true, data: await service.accessStatistics() });
const recentEvents = async (req, res) => {
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw createHttpError(400, 'limit phải từ 1 đến 50');
    return res.json({ success: true, data: await service.recentEvents(limit) });
};
const deviceStatistics = async (_req, res) => res.json({ success: true, data: await service.deviceStatistics() });

module.exports = { summary, accessStatistics, recentEvents, deviceStatistics };
