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
const INTERNAL_PACKAGES = ['@jujia/agent-core', '@jujia/shared', '@jujia/shared-ipc'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});
