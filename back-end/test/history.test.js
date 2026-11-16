const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeHistory } = require('../src/utils/history');

test('history merges face access events and one command row with its request and result', () => {
    const result = mergeHistory([
        {
            id: 'event-1', user_id: 'user-1', device_id: 'device-1', decision: 'allowed',
            occurred_at: '2026-11-16T09:00:00.000Z', access_users: { full_name: 'Linh' },
        },
    ], [
        {
            id: 'command-1', device_id: 'device-1', command: 'unlock', status: 'acknowledged',
            requested_at: '2026-11-16T09:01:00.000Z', executed_at: '2026-11-16T09:01:01.000Z',
            profiles: { full_name: 'Operator' },
        },
    ], { from: 0, to: 9 });

    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map((item) => item.record_type), ['device_command', 'access_event']);
    assert.equal(result.items[0].result, 'acknowledged');
    assert.equal(result.items[0].requested_at, '2026-11-16T09:01:00.000Z');
    assert.equal(result.items[0].executed_at, '2026-11-16T09:01:01.000Z');
    assert.equal(result.items[1].result, 'allowed');
});

test('history pagination is applied after the two sources are sorted together', () => {
    const result = mergeHistory([
        { id: 'event-1', decision: 'denied', occurred_at: '2026-11-16T09:00:00.000Z' },
    ], [
        { id: 'command-1', command: 'lock', status: 'failed', requested_at: '2026-11-16T09:02:00.000Z' },
    ], { from: 1, to: 1 });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].record_type, 'access_event');
    assert.equal(result.total, 2);
});
