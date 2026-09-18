import { ToolError, type StoredTool, type ToolContext, type ToolKind, type ToolOutcome } from './types';

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

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny' | 'timeout';

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
}

export type PermissionResolver = (req: PermissionRequest) => Promise<PermissionDecision>;

export interface RunToolOptions {
  /** 会话内白名单（工具名 → 是否已「总是允许」） */
  alwaysAllow?: Set<string>;
  /** 生成请求 id 的方式（测试可注入确定性实现） */
  newId?: () => string;
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
  rawArgs: unknown,
  ctx: ToolContext,
  resolver: PermissionResolver,
  opts: RunToolOptions = {},
): Promise<RunToolResult> {
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

  // 2) 权限门
  const needsApproval = tool.kind !== 'read';
  const alwaysAllowed = opts.alwaysAllow?.has(tool.name) ?? false;
  let asked = false;
  let decision: PermissionDecision | undefined;

  if (needsApproval && !alwaysAllowed) {
    asked = true;
    const paths = collectPaths(rawArgs);
    decision = await resolver({
      id: newId(),
      toolName: tool.name,
      kind: tool.kind,
      summary: `${tool.name} · ${kindLabel(tool.kind)}`,
      args: rawArgs,
      paths,
    });

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
      opts.alwaysAllow?.add(tool.name);
    }
  }

  // 3) 执行
  try {
    const outcome = await tool.run(args as never, ctx);
    const evidence = { ...outcome.evidence, durationMs: Date.now() - started };
    return {
      outcome: { ...outcome, evidence },
      asked,
      ...(decision ? { decision } : {}),
      durationMs: evidence.durationMs,
    };
  } catch (err) {
    if (err instanceof ToolError) {
      // 路径拒绝等安全类错误：回模型可读的说明，同时让 UI 能拿到 code
      return {
        outcome: { ok: false, content: `[${err.code}] ${err.message}` },
        asked,
        ...(decision ? { decision } : {}),
        durationMs: Date.now() - started,
      };
    }
    return {
      outcome: {
        ok: false,
        content: `工具执行异常：${err instanceof Error ? err.message : String(err)}`,
      },
      asked,
      ...(decision ? { decision } : {}),
      durationMs: Date.now() - started,
    };
  }
}

function kindLabel(kind: ToolKind): string {
  return kind === 'read' ? '读取' : kind === 'write' ? '写入' : '执行命令';
}

/** 从原始入参里尽力提取路径，供权限弹窗展示「要动哪些文件」 */
function collectPaths(rawArgs: unknown): string[] {
  if (typeof rawArgs !== 'object' || rawArgs === null) return [];
  const p = (rawArgs as { path?: unknown }).path;
  return typeof p === 'string' ? [p] : [];
}
