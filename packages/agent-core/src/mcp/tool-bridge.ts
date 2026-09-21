/**
 * MCP 工具桥（W10d）—— 把**用户已批准**的 MCP 工具接进工具注册表，走同一套权限门。
 *
 * 三条纪律：
 *
 * 1. **未批准的工具根本不注册**，而不是"注册了但隐藏"。
 *    隐藏只是 UI 层面看不见，模型仍可能从上下文里知道名字并尝试调用；
 *    不注册 = 注册表里没有这个名字 = 没有调用路径（注册表对未注册名字一律拒绝）。
 *
 * 2. **分级决定"要不要问"，不决定"能不能绕开"**。
 *    `kind` 由 MCP 侧按注解确定性推断（`inferToolKind`，默认 `exec`），
 *    但真正的放行仍由统一的 `runTool` 权限门做。本层**绝不自己询问用户**，
 *    也绝不因为"服务端自称只读"就跳过执行器。
 *
 * 3. **不替服务端校验它的 JSON Schema**。
 *    第三方工具的 schema 我们无法可靠解释，假装校验只会产出错误的拒绝或错误的放行。
 *    这里只做最小归一（非对象 → `{}`），真正的入参校验由服务端负责，
 *    服务端的报错**原样**回给模型（截断但标注），让模型据此自我纠正。
 */

import { ToolError, type StoredTool, type ToolParameterSchema } from '../tools/types';
import type { ToolRegistry } from '../tools/registry';
import { isToolEnabled, type ApprovalOutcome } from './consent';
import type { McpToolProfile } from './mcp';

/**
 * 单次回给模型的结果上限。
 * 第三方工具可能返回巨量文本，直接塞进对话会瞬间打爆上下文与 IPC。
 * 超出即截断**并如实标注**（与文件工具的纪律一致：不假装内容完整）。
 */
export const MAX_MCP_RESULT_BYTES = 128 * 1024;

/** 模型侧工具名的最大长度（OpenAI 函数名上限 64） */
export const MAX_TOOL_NAME_LENGTH = 64;

/** 一次工具调用的结果（已由适配层从 MCP 报文里抽出文本） */
export interface McpToolCallResult {
  ok: boolean;
  /** 成功时是工具输出文本；失败时是**失败说明**（含服务端原文） */
  text: string;
}

/**
 * 调用实现的抽象。
 * 由主进程注入（内部持有 `McpClient`），因此本层保持纯逻辑、可单测。
 */
export interface McpToolRuntime {
  callTool: (qualifiedName: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
}

export interface RegistrationReport {
  /** 实际注册进工具表的模型侧工具名 */
  registered: string[];
  /** 被跳过的工具及**具体原因**（不静默丢弃） */
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * 把内部标识（`serverId__rawName`）转成**模型可用的函数名**。
 *
 * 为什么需要：内部标识直接来自用户配置的服务端 id 与第三方的工具名，
 * 可能含空格、点、中文、冒号等字符，而模型 provider 只接受 `[A-Za-z0-9_-]` 且长度 ≤ 64。
 * 非法字符统一替换为 `_`。
 *
 * 超长时**保留头部 + 追加确定性哈希后缀**：只截断会让不同工具名塌缩成同一个名字，
 * 注册表随后会因为重名而拒绝其中一个 —— 表面上"少了个工具"，实际很难排查。
 *
 * 清洗后**不含任何字母数字**（例如纯中文名）时返回 null：这类名字会塌缩成
 * 只由下划线构成的串，不同工具极易撞成同一个名字（`中文名` 与 `日本語` 都会变成 `___`），
 * 与其制造隐性的重名冲突，不如明确拒绝并如实报告。
 */
export function toModelToolName(qualifiedName: string): string | null {
  const cleaned = qualifiedName.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!/[A-Za-z0-9]/.test(cleaned)) return null;
  if (cleaned.length <= MAX_TOOL_NAME_LENGTH) return cleaned;
  const hash = shortHash(cleaned);
  return `${cleaned.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

/** 确定性短哈希（FNV-1a → base36），仅用于消歧，不做安全用途 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-7);
}

/**
 * 归一服务端给的 `inputSchema`。
 *
 * 只在"能确认是对象 schema"时透传；拿不到或形状不对时回落到空对象 schema，
 * **绝不编造字段**（编造的 schema 会让模型按错误的参数调用）。
 */
export function normalizeInputSchema(input: unknown): ToolParameterSchema {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { type: 'object', properties: {} };
  }
  const o = input as Record<string, unknown>;
  if (o['type'] !== 'object') return { type: 'object', properties: {} };

  const rawProps = o['properties'];
  const properties =
    typeof rawProps === 'object' && rawProps !== null && !Array.isArray(rawProps)
      ? (rawProps as Record<string, unknown>)
      : {};

  const out: ToolParameterSchema = { type: 'object', properties };
  const rawRequired = o['required'];
  if (Array.isArray(rawRequired)) {
    const required = rawRequired.filter((x): x is string => typeof x === 'string');
    if (required.length > 0) out.required = required;
  }
  // 刻意不写 additionalProperties：第三方工具可能需要我们看不懂的额外字段，
  // 在这里收紧等于替它做决定（错误的收紧比不收紧更糟）。
  return out;
}

/** 按字节截断，并在需要时给出**可读的截断标注** */
export function clampText(text: string, limit = MAX_MCP_RESULT_BYTES): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= limit) return { text, truncated: false };
  // 先按"字符数 = 上限"粗切（此时字节数最多为 4×上限），再逐步收敛到字节上限内。
  // 逐步收敛能保证不切断成非法 UTF-8（不像直接按字节切片会切出替换字符）。
  let n = Math.min(text.length, limit);
  while (n > 0 && Buffer.byteLength(text.slice(0, n), 'utf8') > limit) {
    n = Math.floor(n * 0.75);
  }
  const head = text.slice(0, n);
  return {
    text: `${head}\n\n[已截断：工具返回共 ${Buffer.byteLength(text, 'utf8')} 字节，此处只保留前 ${Buffer.byteLength(head, 'utf8')} 字节]`,
    truncated: true,
  };
}

/** 给模型看的描述：保留服务端原文，但**附加来源与权限级别**，避免模型误以为是本地工具 */
export function buildToolDescription(profile: McpToolProfile): string {
  const level =
    profile.kind === 'read' ? '只读（服务端声明）' : '需要你逐次确认';
  return (
    `${profile.description}\n\n` +
    `[来源：外部 MCP 服务端「${profile.serverId}」，非本机内置工具。` +
    `权限级别：${level}（依据：${profile.kindReason}）。` +
    `涉及外部系统，请勿假定它能访问本地文件。]`
  );
}

/**
 * 把单个工具档案转成注册表可用的工具定义。
 *
 * 注意 `parse`：只做最小归一。**不是**安全校验 —— 安全靠权限门（kind）+ 服务端自己的校验。
 */
export function toStoredTool(profile: McpToolProfile, runtime: McpToolRuntime): StoredTool {
  const name = toModelToolName(profile.qualifiedName);
  if (name === null) {
    throw new Error(`工具名无法转换为模型可用格式：${profile.qualifiedName}`);
  }
  return {
    name,
    description: buildToolDescription(profile),
    kind: profile.kind,
    parameters: normalizeInputSchema(profile.inputSchema),
    parse: (raw) =>
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {},
    async run(args, ctx) {
      const signal = ctx.signal;
      if (signal?.aborted) {
        throw new ToolError('aborted', `调用 ${profile.rawName} 之前已被中止`);
      }

      const call = runtime.callTool(profile.qualifiedName, args as Record<string, unknown>);

      // 中止语义要**如实**：我们只能停止等待，无法撤回已经发出的请求，
      // 因此文案必须说明"该请求可能已送达服务端"，不能让用户以为它一定没执行。
      const outcome = signal
        ? await Promise.race([
            call,
            new Promise<null>((resolve) => {
              signal.addEventListener('abort', () => resolve(null), { once: true });
            }),
          ])
        : await call;

      if (outcome === null) {
        void call.catch(() => undefined); // 迟到的结果/异常不再影响调用方
        throw new ToolError(
          'aborted',
          `调用 ${profile.rawName} 期间被中止；注意：该请求可能已送达 MCP 服务端`,
        );
      }

      if (!outcome.ok) {
        const { text } = clampText(outcome.text === '' ? '服务端未给出失败原因' : outcome.text);
        return {
          ok: false,
          content: `外部工具 ${profile.rawName} 调用失败：${text}`,
          // 不伪造 paths：我们无从知道第三方进程动了什么，编造证据比没有证据更糟
          evidence: { bytes: Buffer.byteLength(outcome.text, 'utf8') },
        };
      }

      const { text, truncated } = clampText(outcome.text);
      return {
        ok: true,
        content: text === '' ? `（${profile.rawName} 执行成功，但没有返回文本内容）` : text,
        evidence: {
          bytes: Buffer.byteLength(outcome.text, 'utf8'),
          ...(truncated ? { truncated: true } : {}),
        },
      };
    },
  };
}

/**
 * 按批准结果把工具注册进表。
 *
 * - 未批准 / 名字非法 / 与已有工具重名 → **跳过并记录原因**，不覆盖、不静默；
 * - 单个工具注册失败不会中断其余工具的注册（一个坏工具不该让整个服务端不可用）。
 */
export function registerMcpTools(
  registry: ToolRegistry,
  profiles: readonly McpToolProfile[],
  approval: ApprovalOutcome,
  runtime: McpToolRuntime,
): RegistrationReport {
  const registered: string[] = [];
  const skipped: RegistrationReport['skipped'] = [];

  for (const profile of profiles) {
    if (!isToolEnabled(approval, profile.qualifiedName)) {
      skipped.push({ name: profile.qualifiedName, reason: '用户未批准该工具' });
      continue;
    }
    const name = toModelToolName(profile.qualifiedName);
    if (name === null) {
      skipped.push({ name: profile.qualifiedName, reason: '工具名清洗后为空，无法注册' });
      continue;
    }
    if (registry.has(name)) {
      skipped.push({ name, reason: '与已注册工具同名，已跳过（不覆盖既有工具）' });
      continue;
    }
    try {
      registry.register(toStoredTool(profile, runtime));
      registered.push(name);
    } catch (err) {
      skipped.push({ name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { registered, skipped };
}

/** 断开服务端时把它的工具从表里摘掉；返回**实际摘掉的数量** */
export function unregisterMcpTools(registry: ToolRegistry, names: readonly string[]): number {
  let removed = 0;
  for (const name of names) {
    if (registry.unregister(name)) removed += 1;
  }
  return removed;
}
