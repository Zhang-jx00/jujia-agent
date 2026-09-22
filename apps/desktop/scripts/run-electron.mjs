import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

/**
 * Electron 启动器（供 npm script 使用）。
 *
 * 为什么需要它：若环境中存在 `ELECTRON_RUN_AS_NODE=1`（部分 IDE / Agent 环境会设置），
 * Electron 会退化成纯 Node 进程，`require('electron')` 只返回可执行文件路径字符串，
 * `electron.app` 为 undefined，表现为 `TypeError: Cannot read properties of undefined
 * (reading 'requestSingleInstanceLock')`（2026-09-18 实测踩坑）。
 * 这里显式移除该变量，保证冒烟与开发脚本行为一致。
 *
 * 另外两件事都是被真实报错逼出来的：
 * 1. **入口按脚本自身位置解析**，不依赖当前工作目录 ——
 *    否则"从仓库根启动"会去找 `<仓库根>/out/main/index.js`，Electron 只会弹一个
 *    看不懂的「Unable to find Electron app」对话框（2026-09-22 实测）。
 * 2. **构建产物不存在时给出可执行的提示**，而不是把 Electron 的原始报错丢给用户。
 */

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(entry)) {
  console.error(
    [
      `找不到构建产物：${entry}`,
      '',
      '请先构建，或直接用会自己构建的入口：',
      '  npm run app      # 构建 + 启动（推荐）',
      '  npm run dev      # 开发模式（带热更新）',
      '  npm run build    # 只构建',
      '  npm run smoke    # 构建 + 启动 + 断言（自检用）',
    ].join('\n'),
  );
  process.exit(1);
}

const args = [entry, ...process.argv.slice(2)];

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
