import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/coverage/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': 'off',
      // 防 Yan 式巨石文件：单文件逻辑行上限
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
);
