/**
 * 内置终端的纯逻辑层（W9b）。
 *
 * 这里只放**可单测、无副作用**的部分：shell 选择、环境变量装配、尺寸夹紧、输出分块。
 * 真正调 `node-pty` 放在主进程（`apps/desktop/src/main/terminal-service.ts`），
 * 这样原生依赖只出现在一处，测试不需要加载 .node。
 *
 * 依据 2026-09-20 联网核实（卡片 016）：
 * - 必须设 `name: 'xterm-256color'` 与 `TERM/COLORTERM`，否则输出是单色的；
 * - 终端是 **exec 类高副作用能力**，启动前必须走权限门（在本模块只声明语义，不自行放行）。
 */

import { join } from 'node:path';

export interface ShellSpec {
  file: string;
  args: string[];
}

/** 终端尺寸边界：过小会让 TUI 崩，过大会撑爆缓冲区 */
export const TERMINAL_LIMITS = {
  minCols: 20,
  maxCols: 500,
  minRows: 5,
  maxRows: 300,
  /** 单个数据块上限（字符）：防止一次性巨量输出把 IPC 打爆 */
  maxChunkChars: 64 * 1024,
} as const;

/**
 * 选择 shell。
 * Windows 优先用 `ComSpec`（等价于用户环境里的 cmd），**不写死路径**；
 * 类 Unix 用 `SHELL`。
 *
 * 回退**必须是绝对路径**（2026-09-23 修）：此前回退到裸 `'cmd.exe'`，
 * 那会走 PATH 查找 —— 只要 PATH 里靠前的位置有一个同名文件，被执行的就不是系统 cmd。
 * 现在回退到 `%SystemRoot%\System32\cmd.exe`（再退到 `C:\Windows\System32\cmd.exe`）。
 */
export function pickShell(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): ShellSpec {
  if (platform === 'win32') {
    const shell = env['ComSpec']?.trim();
    if (shell !== undefined && shell !== '') return { file: shell, args: [] };
    const root = env['SystemRoot']?.trim() ?? env['windir']?.trim();
    const base = root !== undefined && root !== '' ? root : 'C:\\Windows';
    return { file: join(base, 'System32', 'cmd.exe'), args: [] };
  }
  const shell = env['SHELL']?.trim();
  return { file: shell !== undefined && shell !== '' ? shell : '/bin/bash', args: [] };
}

/**
 * 敏感环境变量的特征（2026-09-23 新增）。
 *
 * 为什么必须剔除：Agent **能在终端里执行命令**，于是"终端子进程的环境变量"等于
 * 一份随时可被读取的密钥清单 —— 模型只要跑一句 `env` 就能把宿主环境里的密钥带走。
 * 这些变量对终端里的日常命令也没有用处，剔掉是净收益。
 */
const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

/** 代理类变量：**保留**（否则终端里的网络会坏），但要脱掉 URL 里内嵌的用户名口令 */
const PROXY_ENV_RE = /PROXY/i;

/** 去掉代理 URL 里的 `user:pass@` 部分 */
export function stripUrlCredentials(value: string): string {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1');
}

/** 当前会被剔除的敏感变量名（按名排序，便于测试与界面展示） */
export function sensitiveEnvKeys(base: Record<string, string | undefined>): string[] {
  return Object.keys(base)
    .filter((k) => SENSITIVE_ENV_RE.test(k))
    .sort();
}

/**
 * 装配终端环境变量。
 *
 * 关键点（缺一个就会有"看起来能用但不对"的问题）：
 * - `TERM=xterm-256color`：告诉子进程它面对的是什么终端 → 解锁 256 色；
 * - `COLORTERM=truecolor`：解锁 24 位真彩色；
 * - 清掉 `ELECTRON_RUN_AS_NODE`：本机这个变量会把 Electron 退化成纯 Node
 *   （项目里已踩过多次），绝不能传给终端里的子进程；
 * - **剔除敏感变量**（见 SENSITIVE_ENV_RE），代理变量只脱敏不剔除。
 */
export function buildTerminalEnv(
  base: Record<string, string | undefined>,
  opts: { workspaceRoot: string } = { workspaceRoot: process.cwd() },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    if (SENSITIVE_ENV_RE.test(k)) continue;
    env[k] = PROXY_ENV_RE.test(k) ? stripUrlCredentials(v) : v;
  }
  env['TERM'] = 'xterm-256color';
  env['COLORTERM'] = 'truecolor';
  // 让终端里的子进程知道工作区在哪，便于脚本按工作区解析相对路径
  env['JUJIA_WORKSPACE'] = opts.workspaceRoot;
  return env;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** 夹紧尺寸：非数字/越界一律收敛到合法范围（**不报错**，因为 resize 是高频事件） */
export function clampSize(input: { cols?: unknown; rows?: unknown }): TerminalSize {
  const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    cols: clamp(input.cols, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols, 80),
    rows: clamp(input.rows, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows, 24),
  };
}

/**
 * 把一段 PTY 输出切成不超过上限的块。
 * 为什么需要：一次 `cat` 大文件可能吐出几百 KB，单次 IPC 发送会卡住渲染层。
 */
export function splitChunks(text: string, max = TERMINAL_LIMITS.maxChunkChars): string[] {
  if (text === '') return [];
  if (text.length <= max) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

/**
 * 终端会话的**权限语义**声明。
 *
 * 终端能执行任意命令，因此归为 `exec` 类：**每次新建会话都必须经用户确认**。
 * 这里只返回给调用方看的说明文本，真正的判定与弹窗由主进程的权限门做
 * （权限门永远在本机，不交给模型 —— 见 docs/PRODUCT-GOAL.md）。
 */
export function describeTerminalPermission(shell: ShellSpec, workspaceRoot: string): string {
  return `启动终端会话：${shell.file}（工作目录 ${workspaceRoot}）`;
}
