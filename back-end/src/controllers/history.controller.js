const service = require('../services/history.service');
const { createHttpError, parsePagination, assertUuid } = require('../utils/http');

const commandStatuses = new Set(['pending', 'sent', 'acknowledged', 'failed', 'expired']);

const parseFilters = (query) => {
    const filters = {};
    for (const field of ['user_id', 'device_id']) if (query[field]) filters[field] = assertUuid(query[field], field);
    if (query.event_type !== undefined) {
        if (!['face', 'door_command'].includes(query.event_type)) throw createHttpError(400, 'event_type chỉ nhận face hoặc door_command');
        filters.event_type = query.event_type;
    }
    if (query.result !== undefined) {
        if (!['allowed', 'denied', ...commandStatuses].includes(query.result)) throw createHttpError(400, 'result không hợp lệ');
        filters.result = query.result;
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
    const result = await service.listHistory(parseFilters(req.query), parsePagination(req.query));
    return res.json({ success: true, data: result.items, pagination: result.pagination });
};

const csvCell = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
};

const exportCsv = async (req, res) => {
    const rows = await service.exportHistory(parseFilters(req.query));
    const columns = ['id', 'record_type', 'event_type', 'action', 'source', 'decision', 'confidence', 'reason', 'occurred_at', 'requested_at', 'executed_at', 'user_id', 'actor_name', 'device_id', 'device_code', 'device_name'];
    const values = rows.map((row) => [
        row.id, row.record_type, row.event_type, row.action, row.source, row.result, row.confidence, row.reason,
        row.occurred_at, row.requested_at, row.executed_at, row.user_id, row.actor_name,
        row.device_id, row.devices?.device_code, row.devices?.device_name,
    ]);
    const csv = `\uFEFF${[columns, ...values].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="access-history-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
};

module.exports = { list, exportCsv };
