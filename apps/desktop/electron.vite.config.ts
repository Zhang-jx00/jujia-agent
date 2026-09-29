import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * 说明：本文件被 apps/desktop/tsconfig.json 排除在应用类型检查之外。
 * 原因：vite 7 已切换到 rolldown 类型，而 @vitejs/plugin-react 6 的插件签名仍基于 rollup 类型，
 * 二者在 plugin 的 `MinimalPluginContext` 上有结构性不兼容（生态问题，非本项目代码问题）。
 * 该文件在构建时由 electron-vite 实际加载校验，因此不影响正确性。
 *
 * externalizeDepsPlugin 默认把 package.json 的 dependencies 全部外部化，
 * 但 @jujia/* 是本仓库的 TS 源码包（无 build 产物），必须打包进产物，
 * 否则运行时会出现 ERR_MODULE_NOT_FOUND（2026-09-18 实测）。
 */
const INTERNAL_PACKAGES = ['@jujia/agent-core', '@jujia/shared', '@jujia/shared-ipc', '@jujia/ui-tokens'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })],
  },
  renderer: {
    /**
     * `.bcmap`（PDF 预定义 CMap）与 `.pfb`（标准字体）不是 Vite 认识的资源类型，
     * 不认识就会当成 JS 去解析（报 "invalid JS syntax"）。M19b 要把它们内联进包，
     * 所以在这里声明"它们是资源"—— `.ttf` 本来就在 Vite 的默认资源表里，不用加。
     */
    assetsInclude: ['**/*.bcmap', '**/*.pfb'],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // 渲染层只能引用「无 node 依赖」的纯逻辑模块。
        // 直接引 @jujia/shared 根会把依赖 node:path 的存储模块带进浏览器包（实测构建失败）。
        '@jujia/shared/stream-batcher': resolve('../../packages/shared/src/stream-batcher.ts'),
      },
    },
    plugins: [react()],
  },
});
