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
  /**
   * 同时在开的会话上限（跨工作区计数）。
   * T23 之后会话**活得过页签切换**，所以这个数不能再靠"切走就杀"来兜底 ——
   * 没有上界时，来回切工作区会攒出渲染层已经叫不出名字的 PTY。
   */
  maxSessions: 3,
  /**
   * 每个会话留存的输出尾部上限（字符）：切走期间的输出靠它补回视图。
   * 必须有界 —— `yes` 这类一直吐的进程，留全量等于内存随运行时长无限涨。
   */
  maxTailChars: 128 * 1024,
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

/**
 * 这个名字是否属于"值不能离开本机、也不能抄到别处磁盘"的那一类。
 *
 * 判据的**唯一来源**是上面那张表。导出给审计摘要用（M4 收尾 · 其二）：
 * 终端环境剔除的键名，与审计文件里不许落盘的参数名，本来就是同一件事 ——
 * 两处各写一张表，迟早一边多一个词、另一边漏一个词（本项目反复踩的那族病）。
 */
export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_RE.test(name);
}

/** 代理类变量：**保留**（否则终端里的网络会坏），但要脱掉 URL 里内嵌的用户名口令 */
const PROXY_ENV_RE = /PROXY/i;

/** 去掉代理 URL 里的 `user:pass@` 部分 */
export function stripUrlCredentials(value: string): string {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1');
}

/** 当前会被剔除的敏感变量名（按名排序，便于测试与界面展示） */
export function sensitiveEnvKeys(base: Record<string, string | undefined>): string[] {
  return Object.keys(base)
    .filter(isSensitiveEnvName)
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
    if (isSensitiveEnvName(k)) continue;
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

/**
 * 这一类门在账本里的说法（T41 · 2026-10-15）。
 *
 * 为什么要放在纯模块里而不是在接线处现写：账本上那一行与规则页"覆盖范围"那一格
 * 说的是**同一件事**（这台机器的终端只信当面答复、不查策略表）。抄两份，早晚一份说"不查规则"、
 * 另一份说"按规则放行"。
 *
 * 这句必须写"不查策略表"：用户在规则页写的 `deny terminal` 今天对他无效 ——
 * 收紧到走策略判定属"改权限映射"（停牌①，待所有者定），本轮只把已有事实记全、说清。
 */
export const TERMINAL_GATE_REASON =
  '内置终端：每次新起会话都当面问（这一步不查策略表，规则页写的 terminal 规则对它无效）';

/* ------------------------------------------------------------------ *
 * T23：会话生命周期（"pty 常驻但可手工关闭"）
 *
 * 三条规则放在一起，是因为它们回答的是同一个问题：**什么时候真的会多出一个进程**。
 * 权限门的语义（"每次新建会话都要确认"）由 `decideStart` 的结果决定 ——
 * 只有 `spawn` 才需要审批，`adopt` 一个新进程都没起，因此不需要第二次确认。
 * ------------------------------------------------------------------ */

export type StartDecision =
  /** 接回本工作区已有的会话：**不启动新进程**，也就不再要一次审批 */
  | { kind: 'adopt'; sessionId: string; reason: string }
  /** 确实要新建会话：调用方必须先过权限门 */
  | { kind: 'spawn' }
  /** 达到上限：直接拒绝，并把理由给用户（不偷偷杀掉别的会话） */
  | { kind: 'refuse'; reason: string };

/**
 * 判断"点启动"该接回、该新起、还是该拒绝。
 *
 * 输入用 `liveSessionId` 而不是"有没有"的布尔：接回要把那个会话的 id 交回去；
 * 让调用方自己再查一次，就等于允许两处对"谁活着"的判断各自漂移。
 *
 * 顺序是刻意的：**先看有没有可接回的会话，再看上限**。
 * 反过来会导致"到上限时点启动被拒"，而其实用户只是想回到自己那个还在跑的终端里。
 */
export function decideStart(input: {
  liveSessionId: string | null;
  liveCount: number;
  maxSessions?: number;
}): StartDecision {
  if (input.liveSessionId !== null) {
    return {
      kind: 'adopt',
      sessionId: input.liveSessionId,
      reason: '本工作区已有一个仍在运行的终端会话，直接接回（不会再启动第二个进程）',
    };
  }
  const max = input.maxSessions ?? TERMINAL_LIMITS.maxSessions;
  const live = Number.isFinite(input.liveCount) && input.liveCount > 0 ? input.liveCount : 0;
  if (live >= max) {
    return {
      kind: 'refuse',
      reason: `终端会话已达上限 ${String(max)} 个。请先在对应的终端页「结束会话」，再开新的`,
    };
  }
  return { kind: 'spawn' };
}

/** 只保留末尾若干个字符（切走期间的输出靠它补回视图，见 TERMINAL_LIMITS.maxTailChars） */
export function trimTail(
  existing: string,
  incoming: string,
  max: number = TERMINAL_LIMITS.maxTailChars,
): string {
  const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  if (cap === 0) return '';
  const merged = existing + incoming;
  return merged.length <= cap ? merged : merged.slice(merged.length - cap);
}

/**
 * 会话在用户切走页签期间退出了 —— 回来时必须看得见"是它自己结束的"。
 * 只写"未启动"会让人以为是页签切换把会话弄丢了（这正是 T23 要修的错觉）。
 */
export function describeExitNotice(exitCode: number): string {
  return `上一个终端会话已结束（退出码 ${String(exitCode)}），需要时请重新启动`;
}
