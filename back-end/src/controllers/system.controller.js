const systemService = require('../services/system.service');

const status = async (_req, res) => res.json({ success: true, data: await systemService.getSystemStatus() });

module.exports = { status };
