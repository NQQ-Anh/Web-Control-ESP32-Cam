const service = require('../services/events.service');
const { createHttpError, parsePagination, assertUuid } = require('../utils/http');

const parseFilters = (query) => {
    const filters = {};
    for (const field of ['user_id', 'device_id']) if (query[field]) filters[field] = assertUuid(query[field], field);
    if (query.decision !== undefined) {
        if (!['allowed', 'denied'].includes(query.decision)) throw createHttpError(400, 'decision chỉ nhận allowed hoặc denied');
        filters.decision = query.decision;
    }
    for (const field of ['from', 'to']) {
        if (query[field] === undefined) continue;
        if (typeof query[field] !== 'string' || Number.isNaN(Date.parse(query[field]))) throw createHttpError(400, `${field} phải là thời gian ISO hợp lệ`);
        filters[field] = new Date(query[field]).toISOString();
    }
    if (filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to)) throw createHttpError(400, 'from phải trước to');
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100)) throw createHttpError(400, 'Từ khóa tìm kiếm không hợp lệ');
    filters.q = query.q;
    return filters;
};

const list = async (req, res) => {
    const query = parseFilters(req.query);
    const result = await service.listEvents(query, parsePagination(req.query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const get = async (req, res) => res.json({ success: true, data: await service.getEvent(assertUuid(req.params.id)) });

const csvCell = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
};

const exportCsv = async (req, res) => {
    const events = await service.exportEvents(parseFilters(req.query));
    const rows = [
        ['id', 'occurred_at', 'decision', 'confidence', 'reason', 'event_source', 'user_id', 'employee_code', 'full_name', 'device_id', 'device_code', 'device_name'],
        ...events.map((event) => [event.id, event.occurred_at, event.decision, event.confidence, event.reason, event.event_source, event.user_id, event.access_users?.employee_code, event.access_users?.full_name, event.device_id, event.devices?.device_code, event.devices?.device_name])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="access-events-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
};

module.exports = { list, get, exportCsv };
