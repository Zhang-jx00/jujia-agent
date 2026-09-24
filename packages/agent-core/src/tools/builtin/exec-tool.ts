import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { killProcessTree } from '../../commands/process';
import { buildTerminalEnv, pickShell } from '../../terminal/terminal';
import { displayPath, guardPath } from '../path-guard';
import { ToolError, type StoredTool, type ToolDefinition, type ToolContext, type ToolOutcome } from '../types';

/**
 * 内置命令执行工具（M4 / 轨道铺设计划 8）。
 *
 * 这是本项目里**第一个让模型自己动手**的内置工具，所以它的每一条约束都是安全语义，
 * 不是风格问题：
 *
 * 1. **每次都要人确认**（硬 ask）。它不是靠"我们记得弹窗"实现的 —— `kind` 声明为 `'exec'`，
 *    权限引擎对执行类的判定就是 `bypassable: false`（`permissions/policy.ts` 的最后一条），
 *    所以"本次会话总是允许"这类白名单**结构上按不动它**。变异 M13 盯着 `kind` 被改松。
 * 2. **工作目录只能在工作区里面**。用与文件工具同一条 `guardPath`（含真实路径校验，挡 symlink 外逃）。
 * 3. **子进程环境剔除敏感变量**。Agent 能执行命令之后，`env` 一句就能把宿主密钥带走；
 *    复用终端那套 `buildTerminalEnv`（剔 `*KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH`、
 *    代理只脱敏不删、清掉 `ELECTRON_RUN_AS_NODE`）。
 * 4. **必超时、必限输出、必关 stdin**。三件都能让"看起来跑完了"变成"其实挂住了"：
 *    交互式命令会永远等输入 → stdin 直接 end；超时用**按进程树杀**（Windows 上 `child.kill()`
 *    杀不掉孙进程）；输出无上限会把上下文撑爆 → 截断并**如实标注**。
 * 5. 超时报"超时"，拒绝对"用户拒绝" —— 两者混淆会让人以为权限门坏了（与终端、钩子同一口径）。
 *
 * 为什么执行**经过 shell**（而 git 模块刻意不经过）：git 是"参数数组确定的子命令"，
 * 拼 shell 就是纯粹的注入面；而这个工具的目的就是跑任意命令，管道与重定向是需求而不是漏洞。
 * 边界因此不放在"禁止 shell 语法"，而是放在**每次都要人看过这条命令行**（弹窗摘要里原样给出）
 * + 工作目录受限 + 环境受限 + 超时与输出受限。
 */

export const EXEC_TOOL_NAME = 'run_command';

/** 默认超时：30 秒够大多数构建/测试之外的短命令，又不至于让卡住的命令长期占着 */
export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
/** 上限：再长就该改用"用户自己驱动的终端"，而不是让模型吊着一个进程 */
export const MAX_EXEC_TIMEOUT_MS = 300_000;
/** 输出上限（stdout + stderr 各自）：超出即截断并如实标注，绝不假装完整 */
export const MAX_EXEC_OUTPUT_BYTES = 256 * 1024;

export interface ExecArgs {
  command: string;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

/** 与 `hooks/runner` 同一思路：把 spawn 抽象成可注入的形状，真实路径与测试路径共用逻辑 */
export interface ExecChild {
  readonly pid?: number | undefined;
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  readonly stdout: DataStream;
  readonly stderr: DataStream;
  readonly stdin: { write(c: string): unknown; end(): unknown; on(ev: string, cb: (e: unknown) => void): void };
  on(ev: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  on(ev: 'error', listener: (err: Error) => void): void;
  kill(signal?: string): boolean;
}

interface DataStream {
  on(ev: 'data', cb: (chunk: unknown) => void): void;
}

export type ExecSpawn = (
  file: string,
  args: ReadonlyArray<string>,
  options: Record<string, unknown>,
) => ExecChild;

export interface ExecDeps {
  spawn: ExecSpawn;
  platform: NodeJS.Platform;
  baseEnv: Record<string, string | undefined>;
}

/** shell 怎么起：Windows 走 `%ComSpec%`（回退是**绝对路径**，不接受裸名 —— 裸名会走 PATH 查找），POSIX 走 `$SHELL` */
export function buildExecInvocation(
  command: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): { file: string; args: string[] } {
  const shell = pickShell(platform, env);
  const flag = platform === 'win32' ? '/d' : undefined;
  const args = shell.args.length > 0 ? [...shell.args] : [];
  if (flag !== undefined) args.push(flag);
  args.push(platform === 'win32' ? '/c' : '-c', command);
  return { file: shell.file, args };
}

/** 超时夹在 (0, 上限] 之间：不给"永不超时"的口子 */
export function clampTimeout(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return DEFAULT_EXEC_TIMEOUT_MS;
  return Math.min(Math.floor(ms), MAX_EXEC_TIMEOUT_MS);
}

/** 按字节上限裁剪；返回是否裁过（调用方必须在正文里如实标注） */
export function capOutput(text: string, limit = MAX_EXEC_OUTPUT_BYTES): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= limit) return { text, truncated: false };
  return {
    text: Buffer.from(text, 'utf8').subarray(0, limit).toString('utf8'),
    truncated: true,
  };
}

function toText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
  return '';
}

/**
 * 真正干活的一段。独立出来是为了**可测**：把 spawn 注进来，就能在不启动真实进程的情况下
 * 验证超时、截断、非零退出、拒绝后零执行这些路径。
 */
export function execOnce(args: ExecArgs, ctx: ToolContext, deps: ExecDeps): Promise<ToolOutcome> {
  const timeoutMs = clampTimeout(args.timeoutMs);
  const startedAt = Date.now();

  return (async () => {
    const cwdRaw = args.cwd ?? '.';
    // 与文件工具同一条守卫：越界即抛 ToolError(path_denied)，由 runTool 变成可读失败
    const cwd = await guardPath(ctx.workspaceRoot, cwdRaw);
    const info = await stat(cwd).catch(() => null);
    if (info === null || !info.isDirectory()) {
      throw new ToolError('not_found', `工作目录不存在或不是目录：${displayPath(ctx.workspaceRoot, cwd)}`);
    }

    const invocation = buildExecInvocation(args.command, deps.platform, deps.baseEnv);
    const env = buildTerminalEnv(deps.baseEnv, { workspaceRoot: cwd });

    let child: ExecChild;
    try {
      child = deps.spawn(invocation.file, invocation.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // 我们自己就是**显式**通过 shell 起的（invocation 里已经是 shell 的绝对路径），
        // 再开 shell:true 会变成"shell 里套一层隐式 shell"，路径解析不可控
        shell: false,
      });
    } catch (err) {
      throw new ToolError('io_error', `启动进程失败：${err instanceof Error ? err.message : String(err)}`);
    }

    let stdout = '';
    let stderr = '';
    let outTruncated = false;
    let errTruncated = false;
    let timedOut = false;
    // 用对象持有：回调里的赋值不会被控制流分析跟踪，直接写 `let e: Error | null` 会让下面的
    // 判空把类型窄化成 never（TS 实测）
    const spawnFailure: { err: Error | null } = { err: null };

    child.stdout.on('data', (chunk) => {
      if (outTruncated) return;
      stdout += toText(chunk);
      // 必须在**追加之后**按字节判：单个 chunk 就可能超过上限（node 的 data 事件最大约 64KB）
      if (Buffer.byteLength(stdout, 'utf8') > MAX_EXEC_OUTPUT_BYTES) {
        const capped = capOutput(stdout);
        stdout = capped.text;
        outTruncated = true;
      }
    });
    child.stderr.on('data', (chunk) => {
      if (errTruncated) return;
      stderr += toText(chunk);
      if (Buffer.byteLength(stderr, 'utf8') > MAX_EXEC_OUTPUT_BYTES) {
        const capped = capOutput(stderr);
        stderr = capped.text;
        errTruncated = true;
      }
    });
    child.on('error', (err) => {
      spawnFailure.err = err;
    });
    // 交互式命令会一直等输入 —— 直接关掉 stdin，让它自己走到 EOF 或报错退出。
    // 这条也顺带挡住了"命令其实卡在等人敲键"被误报成超时。
    child.stdin.on('error', () => undefined); // EPIPE 不处理会直接崩主进程
    child.stdin.end();

    const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        // 按**进程树**杀：Windows 上 child.kill() 只杀 shell 自己，孙进程会留下来继续跑
        killProcessTree(child);
      }, timeoutMs);
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });

    if (spawnFailure.err !== null) {
      throw new ToolError('io_error', `进程执行失败：${spawnFailure.err.message}`);
    }

    const durationMs = Date.now() - startedAt;
    const rel = displayPath(ctx.workspaceRoot, cwd);
    const notes: string[] = [];
    if (timedOut) notes.push(`超时（${timeoutMs}ms）后被强制结束 —— 与"用户拒绝"是两回事`);
    if (outTruncated) notes.push(`标准输出已截断到 ${MAX_EXEC_OUTPUT_BYTES} 字节（非全文）`);
    if (errTruncated) notes.push(`错误输出已截断到 ${MAX_EXEC_OUTPUT_BYTES} 字节（非全文）`);

    const head = timedOut
      ? `命令被超时终止（退出码 ${String(exit.code ?? '未知')}，信号 ${String(exit.signal ?? '无')}）`
      : `退出码 ${String(exit.code ?? '未知')}`;
    const body = [stdout, stderr === '' ? '' : `[stderr]\n${stderr}`].filter((s) => s !== '').join('\n');
    const content = [`${head}｜工作目录 ${rel}`, body, notes.length > 0 ? `[说明] ${notes.join('；')}` : '']
      .filter((s) => s !== '')
      .join('\n');

    return {
      // 命令**跑完了**就算工具成功，非零退出码是给模型的 information，不是工具故障。
      // （把非零退出报成工具失败，模型就看不见 stdout/stderr 了，反而会瞎猜。）
      ok: true,
      content,
      evidence: {
        paths: [cwd],
        durationMs,
        ...(outTruncated || errTruncated ? { truncated: true } : {}),
      },
    };
  })();
}

export const runCommandTool: ToolDefinition<ExecArgs> = {
  name: EXEC_TOOL_NAME,
  description:
    '在工作区内执行一条命令（经系统 shell）。每次执行都需要用户确认；' +
    '工作目录必须在工作区内；子进程环境不含密钥类变量；默认 30 秒超时、输出超限会截断并标注。' +
    '交互式命令不受支持（stdin 会被立即关闭）。',
  // **这一行是安全语义，不是标签**：引擎对 'exec' 判定为硬 ask（任何"总是允许"都压不掉）。
  // 改成 'write' 就变成可被永久放行 —— 变异 M13 专门咬它。
  kind: 'exec',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的完整命令行（会原样展示给用户确认，不要拆成多条隐藏意图）',
      },
      cwd: { type: 'string', description: '工作目录，默认工作区根；必须在工作区内' },
      timeoutMs: {
        type: 'number',
        description: `超时毫秒，默认 ${DEFAULT_EXEC_TIMEOUT_MS}，上限 ${MAX_EXEC_TIMEOUT_MS}`,
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  parse: (raw) =>
    // `.strict()`：JSON Schema 里声明了 additionalProperties:false，parse 就必须真的拒绝，
    // 否则"声明"与"执行"两套口径 —— zod 默认是**静默丢弃**多余字段的（本轮实测抓到）
    z
      .object({
        command: z.string().min(1).max(4000),
        cwd: z.string().min(1).max(1000).optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .parse(raw),
  run: (args, ctx) =>
    execOnce(args, ctx, {
      spawn: ((f, a, o) => spawn(f, [...a], o)) as ExecSpawn,
      platform: process.platform,
      baseEnv: process.env as Record<string, string | undefined>,
    }),
};

/** 内置执行工具集合（与 FILE_TOOLS 同一形状，注册进默认注册表） */
export const EXEC_TOOLS: ReadonlyArray<StoredTool> = [runCommandTool as unknown as StoredTool];
