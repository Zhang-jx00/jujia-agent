import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      'scripts/**',
      // `.tmp/` 是**规定的一次性脚本目录**（探针、变异子集、临时提交说明都写在这儿）；
      // `.trash/` 是 cleanup.py 的 30 天反悔区，里面**就是要被扫掉的旧源码副本**。
      // 不收尾这两处，每轮收尾之后 `npm run lint` 都会去审一次性脚本和已删除的文件 ——
      // 实测：清扫完再跑 lint，报的全是 `.trash` 里的旧副本。
      '**/.tmp/**',
      '**/.trash/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TS 编译器对未定义标识符的检查比 no-undef 更准（官方建议在 TS 文件中关闭）
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          // 允许显式用 `_` 前缀表示「有意忽略」，例如 `for await (const _ev of gen)`
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': 'off',
      // 防单文件巨石：逻辑行上限 800（超限即报错，逼迫拆分职责）
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // 构建/工具脚本（纯 Node ESM/CJS）
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
