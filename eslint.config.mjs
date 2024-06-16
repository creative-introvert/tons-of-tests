import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,
    prettier,
    {
        rules: {
            // Category: "This aint no error"
            '@typescript-eslint/no-unused-vars': 'warn',
            // Category: "Shut up, I know what I'm doing"
            '@typescript-eslint/prefer-for-of': 'off',
            '@typescript-eslint/consistent-type-definitions': 'off',
        },
    },
);
