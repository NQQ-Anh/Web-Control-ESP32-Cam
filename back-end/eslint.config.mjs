import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/**', 'supabase/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.commonjs },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': 'off',
        },
    },
];
