import globals from 'globals';

export default [
    {
        files: ['public/js/**/*.mjs', 'test/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                $: 'readonly',
                jQuery: 'readonly',
                bootstrap: 'readonly',
                moment: 'readonly',
                Chart: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-undef': 'error',
            'prefer-const': 'warn',
            'no-var': 'warn'
        }
    },
    {
        files: ['*.mjs', 'server.mjs', 'config.mjs', 'tuyaClient.mjs', 'consumptionManager.mjs', 'src/managers/tariff.mjs', 'src/managers/weather.mjs', 'alertManager.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly'
            }
        }
    },
    {
        ignores: ['node_modules/**', 'public/json/**', 'sessions/**', '_borrar/**', 'public/js/index.js.legacy']
    }
];
