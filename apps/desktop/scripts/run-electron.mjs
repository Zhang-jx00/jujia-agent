import { spawn } from 'node:child_process';
import electronPath from 'electron';

/**
 * Electron 启动器（供 npm script 使用）。
 *
 * 为什么需要它：若环境中存在 `ELECTRON_RUN_AS_NODE=1`（部分 IDE / Agent 环境会设置），
 * Electron 会退化成纯 Node 进程，`require('electron')` 只返回可执行文件路径字符串，
 * `electron.app` 为 undefined，表现为 `TypeError: Cannot read properties of undefined
 * (reading 'requestSingleInstanceLock')`（2026-09-18 实测踩坑）。
 * 这里显式移除该变量，保证冒烟与开发脚本行为一致。
 */
const args = ['./out/main/index.js', ...process.argv.slice(2)];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-electron] 被信号中断: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
