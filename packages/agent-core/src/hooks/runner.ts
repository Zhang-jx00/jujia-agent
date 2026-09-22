/**
 * 钩子运行器（W5d）：把配置里的钩子进程按顺序跑起来，并翻译成调用方看得懂的结果。
 *
 * 契约细节见 `types.ts` 的文件头（默认禁用 / argv 执行 / stdin-stdout 各一个 JSON /
 * exit 2 = 显式拒绝 / 其余失败 fail-open 但必须可见 / 权限决定取最严格一侧）。
 */

import { spawn } from 'node:child_process';
import { buildArgvCommand, checkArgvSafety } from '../commands/argv';
import { killProcessTree } from '../commands/process';
import {
  emptyHookResult,
  type HookCommandConfig,
  type HookConfig,
  type HookInput,
  type HookOutput,
  type HookPermissionDecision,
  type HookRunParams,
  type HookRunResult,
  type HookRunner,
} from './types';

/** spawn 的最小签名（可注入，便于单测；真实默认用 node:child_process） */
export type HookSpawnLike = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => HookChildLike;

export interface HookChildLike {
  pid?: number | undefined;
  exitCode?: number | null | undefined;
  signalCode?: string | null | undefined;
  kill(signal?: string): unknown;
  stdin: { write: (chunk: string) => unknown; end: () => unknown; on: (e: 'error', cb: (err: Error) => void) => unknown };
  stdout: { on: (e: 'data', cb: (chunk: unknown) => void) => unknown };
  stderr: { on: (e: 'data', cb: (chunk: unknown) => void) => unknown };
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'exit', cb: (code: number | null, signal: string | null) => void): unknown;
}

export interface HookRunnerDeps {
  /**
   * **每次运行都重新取配置**，不做缓存：用户改了钩子配置必须立刻生效，
   * 缓存会让"我明明删掉了它还在跑"变成灵异事件（权限规则表同理）。
   */
  getConfig: () => HookConfig;
  spawnImpl?: HookSpawnLike;
  platform?: NodeJS.Platform;
  onDebug?: (message: string) => void;
}

/** 严格程度：deny > ask > allow（多个钩子给不同决定时取最严格一侧） */
function severity(d: HookPermissionDecision): number {
  return d === 'deny' ? 3 : d === 'ask' ? 2 : 1;
}

function toText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
  return String(chunk);
}

/** 校验 hook 返回的 JSON 结构（非法结构按"失败"处理，不按"拒绝"处理） */
function parseHookOutput(text: string): { ok: true; output: HookOutput } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `stdout 不是合法 JSON：${text.slice(0, 120)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'stdout 必须是 JSON 对象' };
  }
  const o = parsed as Record<string, unknown>;
  if (o['continue'] !== undefined && typeof o['continue'] !== 'boolean') {
    return { ok: false, error: 'continue 必须是布尔值' };
  }
  if (o['reason'] !== undefined && typeof o['reason'] !== 'string') {
    return { ok: false, error: 'reason 必须是字符串' };
  }
  const specific = o['hookSpecificOutput'];
  if (specific !== undefined) {
    if (typeof specific !== 'object' || specific === null || Array.isArray(specific)) {
      return { ok: false, error: 'hookSpecificOutput 必须是对象' };
    }
    const s = specific as Record<string, unknown>;
    if (s['permissionDecision'] !== undefined && !['allow', 'deny', 'ask'].includes(String(s['permissionDecision']))) {
      return { ok: false, error: 'permissionDecision 只能是 allow / deny / ask' };
    }
    if (s['updatedInput'] !== undefined && (typeof s['updatedInput'] !== 'object' || s['updatedInput'] === null)) {
      return { ok: false, error: 'updatedInput 必须是对象' };
    }
    if (s['additionalContext'] !== undefined && typeof s['additionalContext'] !== 'string') {
      return { ok: false, error: 'additionalContext 必须是字符串' };
    }
  }
  return { ok: true, output: parsed as HookOutput };
}

interface OneHookOutcome {
  /** 是否真的启动过进程（被安全规则拦下时为 false） */
  spawned: boolean;
  blocked: boolean;
  reason: string | null;
  output: HookOutput | null;
  diagnostics: string[];
}

export function createProcessHookRunner(deps: HookRunnerDeps): HookRunner {
  const doSpawn: HookSpawnLike = deps.spawnImpl ?? (spawn as unknown as HookSpawnLike);
  const platform = deps.platform ?? process.platform;
  const debug = deps.onDebug ?? ((): void => undefined);

  async function runOne(
    hook: HookCommandConfig,
    input: HookInput,
    config: HookConfig,
  ): Promise<OneHookOutcome> {
    const diagnostics: string[] = [];
    const label = `${hook.command} ${(hook.args ?? []).join(' ')}`.trim();

    // 与 MCP 共用同一套规则：argv 执行、元字符拒绝
    const safety = checkArgvSafety(hook.command, hook.args ?? []);
    if (!safety.ok) {
      return {
        spawned: false,
        blocked: false,
        reason: null,
        output: null,
        diagnostics: safety.errors.map((e) => `${label}: ${e}`),
      };
    }

    const spec = buildArgvCommand(hook.command, hook.args ?? [], platform);
    const timeoutMs = hook.timeoutMs ?? config.timeoutMs;
    const limit = config.maxOutputBytes;

    let child: HookChildLike;
    try {
      child = doSpawn(spec.file, spec.args, {
        cwd: input.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        // 让钩子知道自己在哪个事件里（省得靠参数传递）
        env: { ...process.env, JUJIA_HOOK_EVENT: input.hookEventName },
      });
    } catch (err) {
      return {
        spawned: true,
        blocked: false,
        reason: null,
        output: null,
        diagnostics: [`${label}: 启动失败 ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    let stdout = '';
    let stderrTail = '';
    let truncated = false;
    let timedOut = false;
    let spawnError: string | null = null;

    child.stdout.on('data', (chunk: unknown) => {
      if (truncated) return;
      stdout += toText(chunk);
      // 注意：单个 chunk 就可能超过上限（node 的 data 事件最大约 64KB），
      // 所以必须在**追加之后**按字节判断，光看"追加前是否已满"会漏掉这一种（实测踩过）
      if (Buffer.byteLength(stdout) > limit) {
        truncated = true;
        stdout = Buffer.from(stdout).subarray(0, limit).toString('utf8');
      }
    });
    child.stderr.on('data', (chunk: unknown) => {
      // stderr 只留尾部：钩子可能很吵，但出问题时最后几行最有用
      stderrTail = `${stderrTail}${toText(chunk)}`.slice(-4000);
    });
    child.stdin.on('error', (err: Error) => {
      // 钩子提前退出时写 stdin 会 EPIPE；不监听会变成 unhandled error
      debug(`钩子写入 stdin 失败（已忽略）：${err.message}`);
    });
    child.on('error', (err: Error) => {
      spawnError = err.message;
    });

    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.on('exit', (code: number | null, signal: string | null) => resolve({ code, signal }));
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, { platform, debug });
    }, timeoutMs);

    try {
      child.stdin.write(`${JSON.stringify(input)}\n`);
      child.stdin.end();
    } catch (err) {
      debug(`钩子 stdin 写入异常：${err instanceof Error ? err.message : String(err)}`);
    }

    const { code, signal } = await exited;
    clearTimeout(timer);

    if (spawnError !== null) {
      return { spawned: true, blocked: false, reason: null, output: null, diagnostics: [`${label}: 启动失败 ${spawnError}`] };
    }
    if (timedOut) {
      diagnostics.push(
        `${label}: 超时 ${timeoutMs}ms 已被终止 —— **本次钩子没有生效**（不是拒绝；主权限门仍然照常）`,
      );
      return { spawned: true, blocked: false, reason: null, output: null, diagnostics };
    }
    if (truncated) {
      diagnostics.push(`${label}: 输出超过 ${limit} 字节，已截断（后面的内容没读）`);
    }
    if (stderrTail.trim() !== '') {
      diagnostics.push(`${label}: stderr —— ${stderrTail.trim().slice(0, 400)}`);
    }

    const text = stdout.trim();
    // 空输出 = 什么都不做（合法用法：钩子只想产生副作用，比如记日志）
    const parsed = text === '' ? null : parseHookOutput(text);

    // **退出码 2 = 显式拒绝**：唯一被赋予"阻断"语义的退出码
    if (code === 2) {
      const reason =
        (parsed?.ok === true ? (parsed.output.reason ?? parsed.output.hookSpecificOutput?.permissionDecisionReason) : null) ??
        `钩子以退出码 2 拒绝了本次 ${input.hookEventName}`;
      return { spawned: true, blocked: true, reason, output: parsed?.ok === true ? parsed.output : null, diagnostics };
    }

    if (code !== 0) {
      diagnostics.push(
        `${label}: 退出码 ${code ?? `被信号 ${signal ?? '未知'} 终止`} —— 按失败处理（**不视为拒绝**，只有退出码 2 才是拒绝）`,
      );
      return { spawned: true, blocked: false, reason: null, output: null, diagnostics };
    }

    if (parsed !== null && !parsed.ok) {
      diagnostics.push(`${label}: ${parsed.error} —— 按失败处理（不视为拒绝）`);
      return { spawned: true, blocked: false, reason: null, output: null, diagnostics };
    }

    const output = parsed?.ok === true ? parsed.output : null;
    // continue:false 也是"请求阻止"，与退出码 2 同义（延续业界既有语义）
    if (output?.continue === false) {
      return {
        spawned: true,
        blocked: true,
        reason: output.reason ?? `钩子请求阻止本次 ${input.hookEventName}`,
        output,
        diagnostics,
      };
    }
    return { spawned: true, blocked: false, reason: null, output, diagnostics };
  }

  return {
    async run(params: HookRunParams): Promise<HookRunResult> {
      const config = deps.getConfig();
      const result = emptyHookResult();
      if (!config.enabled) return result;

      const groups = config.events[params.event] ?? [];
      const input: HookInput = {
        hookEventName: params.event,
        sessionId: params.sessionId,
        cwd: params.cwd,
        payload: params.payload,
      };

      for (const group of groups) {
        const matcher = group.matcher;
        if (typeof matcher === 'string' && matcher !== '') {
          let re: RegExp;
          try {
            re = new RegExp(matcher);
          } catch {
            result.diagnostics.push(`matcher 不是合法正则，已跳过该组：${matcher}`);
            continue;
          }
          if (!re.test(params.matchTarget)) continue;
        }

        for (const hook of group.hooks) {
          const one = await runOne(hook, input, config);
          if (one.spawned) result.ranCount += 1;
          result.diagnostics.push(...one.diagnostics);
          if (one.blocked) {
            result.blocked = true;
            result.reason = one.reason;
            // 已被拒绝就不再跑后面的钩子：拒绝之后再产生副作用没有意义
            return result;
          }
          if (one.output === null) continue;

          const specific = one.output.hookSpecificOutput;
          if (typeof specific?.additionalContext === 'string' && specific.additionalContext !== '') {
            result.additionalContext.push(specific.additionalContext);
          }
          if (specific?.updatedInput !== undefined) {
            if (result.updatedInput !== null) {
              result.diagnostics.push('多个钩子都改写了工具输入，以最后一个为准');
            }
            result.updatedInput = specific.updatedInput as Record<string, unknown>;
          }
          if (specific?.permissionDecision !== undefined) {
            const next = specific.permissionDecision;
            // 多个钩子给不同决定时取最严格的一侧（与规则表同一条原则）
            if (result.permissionDecision === null || severity(next) > severity(result.permissionDecision)) {
              result.permissionDecision = next;
              result.permissionReason = specific.permissionDecisionReason ?? one.output.reason ?? null;
            }
          }
          if (one.output.continue === true) result.continueTurn = true;
        }
      }

      return result;
    },
  };
}
