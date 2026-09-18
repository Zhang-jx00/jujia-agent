---
topic: Electron 工程底座的两个必踩坑（P0 实测）
date: 2026-09-18
phase: P0
sources: S4 §1–7（Electron 进程模型/安全清单）、S5 §2–4（性能与打包）
---

# 007 · P0 实测踩坑：ELECTRON_RUN_AS_NODE 与 workspace 包外部化

## 落地决定

1. **所有启动 Electron 的脚本必须显式移除 `ELECTRON_RUN_AS_NODE`。**
   本机环境默认带着 `ELECTRON_RUN_AS_NODE=1`（部分 IDE/Agent 环境会设），此时
   Electron 退化为纯 Node 进程，`require('electron')` 只返回可执行文件路径字符串，
   表现为 `TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')`。
   对策：统一走 `apps/desktop/scripts/run-electron.mjs`（内部 `delete env.ELECTRON_RUN_AS_NODE`）。

2. **`externalizeDepsPlugin` 必须排除本仓库的 `@jujia/*` 包。**
   它默认把 package.json 里 `dependencies` 全部外部化；而 `@jujia/shared-ipc` 是**无 build 产物的
   TS 源码包**，外部化后运行时会去 require `src/channels.ts` → `ERR_MODULE_NOT_FOUND`。
   对策：`externalizeDepsPlugin({ exclude: ['@jujia/shared-ipc'] })`，让内部包打进产物。

3. **冒烟验证不能只等 `did-finish-load`。**
   该事件早于 React 首帧与 IPC 往返，直接读标记会得到 `marker=loading`。
   对策：轮询式读取（200ms × 8s 上限），并同时断言渲染层**没有** `window.require/process/module`
   （即 nodeIntegration 关闭 + sandbox 生效的运行时证据）。

## 边界与取舍

- Electron 44 已**移除** `webContents.getLastWebPreferences()`，原本「启动后读回实际配置做自检」
  的方案不可用。改为**传参前断言配置对象**（纯函数 `assertSecureWebPreferences`，已单测 10 例），
  运行时证据则交给冒烟的 Node 泄漏检查。
- vite 7（rolldown 类型）与 `@vitejs/plugin-react` 6（rollup 类型）存在插件签名结构性不兼容，
  故把 `electron.vite.config.ts` 排除出应用类型检查（构建时由 electron-vite 实际加载校验）。

## 验证方式

`npm run smoke` → 输出 `SMOKE OK: 主进程 + 预加载桥 + 渲染层 + IPC 全链路就绪，且渲染层无 Node 泄漏`。
