import eslint from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

/** @type {import('@typescript-eslint/utils/ts-eslint').FlatConfig[]} */
const config = tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,
    {
        plugins: {'simple-import-sort': simpleImportSort},
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    prettier,
    {
        rules: {
            'simple-import-sort/imports': [
                'error',
                {
                    groups: [
                        // node builtins
                        ['^node:'],
                        // packages
                        ['^@?(?!internal)\\w'],
                        // internal
                        ['^@internal'],
                        ['^'],
                        // relative imports
                        ['^\\.'],
                        // side effects
                        ['^\\u0000'],
                    ],
                },
            ],
            'simple-import-sort/exports': 'error',
            // Category: "This aint no error"
            '@typescript-eslint/no-unused-vars': 'warn',
            // Category: "Shut up, I know what I'm doing"
            '@typescript-eslint/prefer-for-of': 'off',
            '@typescript-eslint/consistent-type-definitions': 'off',
        },
    },
);

export default config;
