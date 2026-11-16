const devicesService = require('../services/devices.service');
const { assertUuid } = require('../utils/http');

const get = async (req, res) => res.json({ success: true, data: await devicesService.getCommand(assertUuid(req.params.id)) });

module.exports = { get };
