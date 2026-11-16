const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUuid, parsePagination, escapePostgrestSearch } = require('../src/utils/http');

test('UUID validation accepts IDs and rejects malformed values', () => {
    const id = 'd9428888-122b-4b9a-b5f2-31d2e7b88a42';
    assert.equal(assertUuid(id), id);
    assert.throws(() => assertUuid('not-an-id'), { statusCode: 400 });
});

test('pagination has safe defaults and an upper limit', () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: 20, from: 0, to: 19 });
    assert.deepEqual(parsePagination({ page: '4', limit: '500' }), { page: 4, limit: 100, from: 300, to: 399 });
});

test('PostgREST search text escapes filter syntax characters', () => {
    assert.equal(escapePostgrestSearch('a,b%_*()'), 'a\\,b\\%\\_\\*\\(\\)');
});
