// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var INTERNAL_PACKAGES = ["@jujia/agent-core", "@jujia/shared", "@jujia/shared-ipc", "@jujia/ui-tokens"];
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })]
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        // 渲染层只能引用「无 node 依赖」的纯逻辑模块。
        // 直接引 @jujia/shared 根会把依赖 node:path 的存储模块带进浏览器包（实测构建失败）。
        "@jujia/shared/stream-batcher": resolve("../../packages/shared/src/stream-batcher.ts")
      }
    },
    plugins: [react()]
  }
});
export {
  electron_vite_config_default as default
};
