import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 与 `apps/desktop/electron.vite.config.ts` 保持一致：`.bcmap` / `.pfb` 是资源不是 JS
  // （M19b 的 PDF 内置资源用 `?inline` 导入，测试也要能解析它们）
  assetsInclude: ['**/*.bcmap', '**/*.pfb'],
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // `.test.tsx` 是渲染层的**组件测试**（2026-09-27 批复：加 jsdom + @testing-library，
    // 只作 devDependencies，不碰运行时）。它们各自在文件头写 `// @vitest-environment jsdom`，
    // 所以默认的 node 环境不受影响。
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'apps/*/src/**/*.test.tsx',
    ],
    passWithNoTests: true,
    reporters: ['default'],

    /**
     * 并发上限（2026-09-23 加，轨道回归计划 1 · 优化）。
     *
     * 为什么加：本机 spawn 子进程很慢、且资源紧张时会出现**加载超时**——
     * 表现为 `FAIL <file> [ <file> ]`（方括号 = 收集阶段就失败，不是用例失败），
     * 而**单独跑同一个文件是全绿的**。这类"假红灯"会让人开始忽略红灯，必须压掉。
     * 同类现象此前已出现两次：json-store 并发写用例超时（已放宽 testTimeout）、
     * hooks/runner 在满并发下收集失败（本次）。
     *
     * 取舍：并发从"按 CPU 核数拉满"降到 4，全量耗时略增，换**结果稳定**。
     * 稳定性对"门禁"的价值高于几分钟的机器时间。
     */
    maxWorkers: 4,
    /**
     * 收集与用例都放宽上限：慢机器上"慢"不等于"坏"。
     * 真正的逻辑错误仍然会让断言失败，放宽的只是时间。
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
