import { ToolError, type StoredTool, type ToolContext, type ToolKind, type ToolOutcome } from './types';
import { decideGate, type GateDecision, type PermissionMode } from '../permissions/policy';
import { noopHookRunner, type HookRunner } from '../hooks/types';
import type { PermissionRule } from '../permissions/rules';

/**
 * 工具执行器：**所有工具执行的唯一入口**，权限门在这里，不在工具内部。
 *
 * 权限策略（对齐知识卡片 002「不自动拒绝」与 PLAN §3.6）：
 * - `read` 类工具：自动放行（只读，不改状态）；
 * - `write` / `exec` 类工具：**一律询问用户**；
 * - 用户拒绝或等待超时：**返回 ok:false 的结果而不是抛异常**——
 *   模型需要看到「用户拒绝了」并据此调整；UI 需要如实区分「拒绝」与「超时」两种文案；
 * - 会话内 `always` 白名单：允许用户对同一工具选择「本次会话总是允许」；
 *   持久化与更完整的状态机（idle→pending→allow/deny/timeout）属 W5。
 */

/**
 * 审批决策。
 * `edit` = **允许但先修改参数再执行** —— 2026 年主流 Agent 框架已把
 * approve / edit / reject / respond 视为四态，edit 是一等公民
 * （例如把 Agent 想写的路径收窄到沙箱内再放行）。见知识卡片 012。
 */
export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny' | 'timeout' | 'edit';

/** 审批答复：edit 时须带 updatedArgs */
export interface PermissionAnswer {
  decision: PermissionDecision;
  /** 仅 decision='edit' 时生效：替换后的入参（会重新过一遍工具的参数校验） */
  updatedArgs?: unknown;
}

export interface PermissionRequest {
  /** 唯一 id，用于 UI 回填决策 */
  id: string;
  toolName: string;
  kind: ToolKind;
  /** 给用户看的一句话摘要（例如「写入 test.md」） */
  summary: string;
  /** 原始入参（供 UI 展开） */
  args: unknown;
  /** 涉及的工作区内相对路径（若可解析） */
  paths: string[];
  /**
   * 能否被「本次会话总是允许」压掉 —— 直接取自 `GateDecision.bypassable`。
   * 弹窗要靠它决定"给不给这个按钮"（外部审查 T19）；缺了它，硬 ask 也会长出一个
   * 只兑现一次的"总是允许"，那是按钮在替引擎撒一个善意的谎。
   */
  bypassable: boolean;
}

/** 兼容两种返回：直接给决策字符串，或给出带 updatedArgs 的完整答复 */
export type PermissionResolver = (
  req: PermissionRequest,
) => Promise<PermissionDecision | PermissionAnswer>;

function normalizeAnswer(a: PermissionDecision | PermissionAnswer): PermissionAnswer {
  return typeof a === 'string' ? { decision: a } : a;
}

export interface RunToolOptions {
  /** 会话内白名单（工具名 → 是否已「总是允许」） */
  alwaysAllow?: Set<string>;
  /** 生成请求 id 的方式（测试可注入确定性实现） */
  newId?: () => string;
  /**
   * 权限模式（默认 `'default'`）。**W10g 起才真正接入**：此前策略层（decideGate）
   * 只被自己的测试调用，模式与敏感路径在运行时是死代码。
   */
  mode?: PermissionMode;
  /** 用户自定义规则（allow/deny/ask，按工具名 glob）。deny / ask 优先于模式 */
  rules?: ReadonlyArray<PermissionRule>;
  /**
   * 高危清单：命中即**硬 ask**（任何「总是允许」都压不掉）。
   *
   * 2026-09-23 接通：此前策略层读 `alwaysAsk`，但**没有任何调用方传它** ——
   * 那条分支在运行时是死代码（只有策略层自己的测试在喂它）。
   * 面向用户的"永远问我"其实走 `ask` 规则（同样是硬 ask）；这里是**引擎级兜底**：
   * 内置高危工具即使被某条 `allow` 规则漏掉，也仍然要过人手。
   */
  alwaysAsk?: ReadonlyArray<string>;
  /** 生命周期钩子运行器（不传 = 没有钩子，行为与从前完全一致） */
  hooks?: HookRunner;
  /** 会话 id：钩子需要在输入里知道自己在哪个会话；手动执行工具时没有会话 */
  sessionId?: string;
}

export interface RunToolResult {
  outcome: ToolOutcome;
  /** 本次是否触发了权限询问 */
  asked: boolean;
  decision?: PermissionDecision;
  /** 若被用户允许并选择「总是允许」，会被写入该集合 */
  durationMs: number;
}

let counter = 0;
const defaultNewId = (): string => `perm-${Date.now()}-${(counter += 1)}`;

export async function runTool(
  tool: StoredTool,
  rawArgsInput: unknown,
  ctx: ToolContext,
  resolver: PermissionResolver,
  opts: RunToolOptions = {},
): Promise<RunToolResult> {
  let rawArgs = rawArgsInput;
  const started = Date.now();
  const newId = opts.newId ?? defaultNewId;

  // 1) 入参校验：不合法直接失败，不进入权限询问（避免骚扰用户）
  let args: unknown;
  try {
    args = tool.parse(rawArgs);
  } catch (err) {
    return {
      outcome: {
        ok: false,
        content: `参数不合法：${err instanceof Error ? err.message : String(err)}`,
      },
      asked: false,
      durationMs: Date.now() - started,
    };
  }

  // 2) 权限门 —— 先过策略层（模式 + 用户规则），再决定要不要问。
  //    注意：deny / ask 规则对**只读**工具同样生效（用户可以要求"这个只读工具也要问我"），
  //    因此不再用 `tool.kind !== 'read'` 作为唯一判据。
  const gate = decideGate({
    mode: opts.mode ?? 'default',
    toolName: tool.name,
    kind: tool.kind,
    args: args as Record<string, unknown>,
    ...(opts.rules ? { rules: opts.rules } : {}),
    ...(opts.alwaysAsk ? { alwaysAsk: opts.alwaysAsk } : {}),
  });

  if (gate.action === 'deny') {
    return {
      outcome: {
        ok: false,
        content: `已按你的权限设置拒绝本次 ${tool.name}：${gate.reason}。请不要重试同一操作，改为向用户说明或换个思路。`,
      },
      asked: false,
      decision: 'deny',
      durationMs: Date.now() - started,
    };
  }

  /**
   * 「本次会话总是允许」只对**软 ask** 生效（`gate.bypassable`）。
   *
   * 硬 ask（高危清单 / 用户 ask 规则 / 敏感路径 / 执行类命令）**任何总是允许都压不掉**：
   * 于是下一段的 PermissionRequest 钩子与弹窗对这些情况照常执行 ——
   * 界面上的一个按钮不能把用户自己写的审批钩子连带废掉。
   */
  const alwaysAllowed =
    gate.action === 'ask' && gate.bypassable && (opts.alwaysAllow?.has(tool.name) ?? false);
  let asked = false;
  let decision: PermissionDecision | undefined;

  // 3) 生命周期钩子：PreToolUse（在权限门**之前**）
  //    放在前面是有意的：钩子可以拒绝（连问都不用问），也可以改写参数
  //    —— 改写后的参数必须**重新过一遍 tool.parse**，否则钩子就成了绕过校验的后门。
  const hooks = opts.hooks ?? noopHookRunner;
  const hookCtx = {
    sessionId: opts.sessionId ?? 'manual',
    cwd: ctx.workspaceRoot,
  };
  const pre = await hooks.run({
    event: 'PreToolUse',
    ...hookCtx,
    payload: { toolName: tool.name, kind: tool.kind, args: summarizeForHook(rawArgs) },
    matchTarget: tool.name,
  });
  if (pre.blocked) {
    return {
      outcome: {
        ok: false,
        content: `本次 ${tool.name} 被钩子拒绝：${pre.reason ?? '（钩子未给出理由）'}。请不要重试同一操作，改为向用户说明。`,
      },
      asked: false,
      decision: 'deny',
      durationMs: Date.now() - started,
    };
  }
  if (pre.updatedInput !== null) {
    try {
      args = tool.parse(pre.updatedInput);
      rawArgs = pre.updatedInput;
    } catch (err) {
      return {
        outcome: {
          ok: false,
          content: `钩子改写后的参数不合法，已拒绝执行：${err instanceof Error ? err.message : String(err)}`,
        },
        asked: false,
        decision: 'deny',
        durationMs: Date.now() - started,
      };
    }
  }

  // 4) 权限门：PermissionRequest 钩子在**弹窗之前**参与决策
  if (gate.action === 'ask' && !alwaysAllowed) {
    const permHook = await hooks.run({
      event: 'PermissionRequest',
      ...hookCtx,
      payload: {
        toolName: tool.name,
        kind: tool.kind,
        args: summarizeForHook(rawArgs),
        reason: gate.reason,
      },
      matchTarget: tool.name,
    });
    if (permHook.blocked || permHook.permissionDecision === 'deny') {
      return {
        outcome: {
          ok: false,
          content: `本次 ${tool.name} 被审批钩子拒绝：${
            permHook.reason ?? permHook.permissionReason ?? '（钩子未给出理由）'
          }。请不要重试同一操作，改为向用户说明。`,
        },
        asked: false,
        decision: 'deny',
        durationMs: Date.now() - started,
      };
    }
    if (permHook.permissionDecision === 'allow') {
      decision = 'allow_once';
    }
  }

  if (gate.action === 'ask' && !alwaysAllowed && decision === undefined) {
    asked = true;
    const paths = collectPaths(rawArgs);
    const answer = normalizeAnswer(
      await resolver({
        id: newId(),
        toolName: tool.name,
        kind: tool.kind,
        summary: summarizeRequest(tool, rawArgs, gate),
        args: rawArgs,
        paths,
        bypassable: gate.bypassable,
      }),
    );
    decision = answer.decision;

    // edit：用用户改过的参数**重新校验**后继续执行（校验失败则如实报错，不执行）
    if (decision === 'edit') {
      try {
        args = tool.parse(answer.updatedArgs);
      } catch (err) {
        return {
          outcome: {
            ok: false,
            content: `参数不合法（经用户修改后）：${err instanceof Error ? err.message : String(err)}`,
          },
          asked,
          decision,
          durationMs: Date.now() - started,
        };
      }
    }

    if (decision === 'deny') {
      return {
        outcome: {
          ok: false,
          content: `用户拒绝了本次 ${tool.name} 调用。请不要重试同一操作，改为说明你需要什么或换个思路。`,
        },
        asked,
        decision,
        durationMs: Date.now() - started,
      };
    }
    if (decision === 'timeout') {
      return {
        outcome: {
          ok: false,
          content: `${tool.name} 的权限请求等待超时（用户未响应）。请勿自动重试，改为向用户说明并等待其指示。`,
        },
        asked,
        decision,
        durationMs: Date.now() - started,
      };
    }
    if (decision === 'allow_always') {
      // 只在软 ask 上记录：用户对硬 ask 点「总是允许」，不该顺带把同一工具的普通操作也永久放行
      if (gate.action === 'ask' && gate.bypassable) {
        opts.alwaysAllow?.add(tool.name);
      }
    }
  }

  // 5) 执行；随后按成功/失败触发 PostToolUse / PostToolUseFailure
  try {
    const outcome = await tool.run(args as never, ctx);
    const evidence = { ...outcome.evidence, durationMs: Date.now() - started };
    const appended = await runPostHook(
      hooks,
      hookCtx,
      outcome.ok ? 'PostToolUse' : 'PostToolUseFailure',
      tool,
      rawArgs,
      outcome,
    );
    return {
      outcome: { ...outcome, content: outcome.content + appended, evidence },
      asked,
      ...(decision ? { decision } : {}),
      durationMs: evidence.durationMs,
    };
  } catch (err) {
    const failed =
      err instanceof ToolError
        ? { ok: false, content: `[${err.code}] ${err.message}` }
        : { ok: false, content: `工具执行异常：${err instanceof Error ? err.message : String(err)}` };
    // 抛异常也算失败：PostToolUseFailure 同样要能参与（否则"出错时没有钩子"很反直觉）
    const appended = await runPostHook(hooks, hookCtx, 'PostToolUseFailure', tool, rawArgs, failed);
    return {
      outcome: { ...failed, content: failed.content + appended },
      asked,
      ...(decision ? { decision } : {}),
      durationMs: Date.now() - started,
    };
  }
}

/**
 * 触发 PostToolUse / PostToolUseFailure，并把钩子给的附加上下文接到工具结果后面。
 *
 * 接在结果里（而不是另开一条消息）的理由：模型看到的必须是一条自洽的工具结果，
 * 否则它会读到"结果"与"补充说明"两条互相独立的输入，容易出现"结果说成功、补充说失败"的错位。
 */
async function runPostHook(
  hooks: HookRunner,
  hookCtx: { sessionId: string; cwd: string },
  event: 'PostToolUse' | 'PostToolUseFailure',
  tool: StoredTool,
  rawArgs: unknown,
  outcome: { ok: boolean; content: string },
): Promise<string> {
  const res = await hooks.run({
    event,
    ...hookCtx,
    payload: {
      toolName: tool.name,
      kind: tool.kind,
      args: summarizeForHook(rawArgs),
      ok: outcome.ok,
      // 工具输出可能很大（一次读文件几 MB），截断后再给钩子，避免灌爆它的 stdin
      result: outcome.content.slice(0, HOOK_RESULT_PREVIEW_CHARS),
      resultTruncated: outcome.content.length > HOOK_RESULT_PREVIEW_CHARS,
    },
    matchTarget: tool.name,
  });
  if (res.additionalContext.length === 0) return '';
  return `\n\n[钩子补充上下文]\n${res.additionalContext.join('\n')}`;
}

/** 给钩子的负载预览上限（字符）：钩子多半只做判断，不需要完整结果 */
const HOOK_RESULT_PREVIEW_CHARS = 4_000;

/**
 * 钩子负载里的参数摘要：对象直接给，其它类型转成可读字符串。
 * 超长字符串（例如 write_file 的 content）截断 —— 钩子不该被一整份文件内容灌爆。
 */
function summarizeForHook(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    return { value: typeof rawArgs === 'string' ? rawArgs.slice(0, 2_000) : rawArgs };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawArgs as Record<string, unknown>)) {
    out[k] = typeof v === 'string' && v.length > 2_000 ? `${v.slice(0, 2_000)}…（已截断）` : v;
  }
  return out;
}

function kindLabel(kind: ToolKind): string {
  return kind === 'read' ? '读取' : kind === 'write' ? '写入' : '执行命令';
}

/** 从原始入参里尽力提取路径，供权限弹窗展示「要动哪些文件」 */
function collectPaths(rawArgs: unknown): string[] {
  if (typeof rawArgs !== 'object' || rawArgs === null) return [];
  const o = rawArgs as { path?: unknown; cwd?: unknown };
  const out: string[] = [];
  if (typeof o.path === 'string') out.push(o.path);
  // 执行类工具没有 path，但有 cwd —— 不显示它，用户就看不到命令将在哪个目录落地
  if (typeof o.cwd === 'string' && !out.includes(o.cwd)) out.push(o.cwd);
  return out;
}

/**
 * 弹窗标题。执行类必须**把命令行本身写进标题**：
 * 只写"run_command · 执行命令"等于让人不看内容就批准 —— 完整参数虽然在 `<details>` 里，
 * 但那是折叠的，而审批这一环的全部价值都在于"人真的看见了要做什么"。
 *
 * 末尾带上**策略给出的理由**（2026-09-27，随外部审查 T1 一起补）：此前弹窗只说"这是读取类操作"，
 * 于是"读普通文件"与"读 `.env`"长得一模一样 —— 用户看不见差别，就只会凭惯性点允许，
 * 分级判定的价值被弹窗自己抹平了。理由本来就是 `decideGate` 产出的，这里只是把它送到人眼前。
 */
function summarizeRequest(tool: StoredTool, rawArgs: unknown, gate: GateDecision): string {
  const base = `${tool.name} · ${kindLabel(tool.kind)}`;
  const withReason = `${base} —— ${gate.reason}`;
  if (tool.kind !== 'exec') return withReason;
  const command =
    typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as { command?: unknown }).command : undefined;
  if (typeof command !== 'string' || command.trim() === '') return withReason;
  // 截断只为排版（弹窗不该被一条 4000 字的命令撑破），完整值仍可在参数里看到
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length > 200
    ? `${base}：${flat.slice(0, 200)}…（完整命令见参数）—— ${gate.reason}`
    : `${base}：${flat} —— ${gate.reason}`;
}
