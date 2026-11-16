const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRegistrationInput } = require('../src/utils/registration');

test('registration trims profile fields and normalizes email', () => {
    assert.deepEqual(normalizeRegistrationInput({
        full_name: '  Linh Nguyen  ',
        email: '  LINH@EXAMPLE.COM ',
        password: 'long-enough-password'
    }), {
        full_name: 'Linh Nguyen',
        email: 'linh@example.com',
        password: 'long-enough-password'
    });
});

test('registration rejects invalid email, short password and client-selected role', () => {
    for (const input of [
        { full_name: 'Linh', email: 'not-an-email', password: 'long-enough-password' },
        { full_name: 'Linh', email: 'linh@example.com', password: 'short' },
        { full_name: 'Linh', email: 'linh@example.com', password: 'long-enough-password', role: 'admin' }
    ]) {
        assert.throws(() => normalizeRegistrationInput(input), { statusCode: 400 });
    }
});
