import { runTool, type PermissionResolver, type RunToolResult } from '../tools/executor';
import type { PermissionMode } from '../permissions/policy';
import type { PermissionRule } from '../permissions/rules';
import type { StoredTool } from '../tools/types';
import type { ToolRegistry } from '../tools/registry';
import { streamChat, type ProviderDeps } from '../providers/openai-compat';
import type { AssembledToolCall } from '../providers/tool-call-accumulator';
import type { ChatMessage, ProviderEvent } from '../providers/types';

/**
 * 三分支 Agent Loop（W4）。
 *
 * 三个分支（对齐 PLAN §3.2）：
 * - **final**：模型给出最终答复 → 结束；
 * - **tool**：模型请求工具 → 串行执行 → 把结果作为 `tool` 消息回传 → 继续下一轮；
 * - **handoff**：模型显式请求移交（调用内建的 `handoff` 工具）→ 结束本轮并标记，交由上层处置。
 *
 * 硬约束：
 * 1. **必须有迭代上界**（maxTurns）——无界循环在模型反复调工具时会把余额烧光；
 * 2. 工具**串行执行**——并发执行会让权限弹窗与文件写入相互踩踏；
 * 3. 工具失败**不中止对话**——把错误文本作为工具结果回给模型，让它自我纠正；
 * 4. 协议配对：带 tool_calls 的 assistant 消息后必须跟齐对应的 tool 消息（id 必须配对）。
 */

export const HANDOFF_TOOL_NAME = 'handoff';

/** 内建移交工具：不碰文件系统、无需权限，仅表达「交给上层/子代理」 */
export const handoffTool: StoredTool = {
  name: HANDOFF_TOOL_NAME,
  description: '把当前任务移交给上层或子代理处理。当你判断该任务超出自身范围时调用。',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: '移交原因' },
      target: { type: 'string', description: '移交目标（可选）' },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  parse: (raw) => raw,
  run: (args) => {
    const a = args as unknown as { reason?: unknown; target?: unknown };
    const reason = typeof a?.reason === 'string' ? a.reason : '（未说明原因）';
    const target = typeof a?.target === 'string' ? ` → ${a.target}` : '';
    return Promise.resolve({ ok: true, content: `已请求移交${target}：${reason}` });
  },
};

export type LoopBranch = 'final' | 'tool' | 'handoff';

export type LoopEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; callId: string; name: string; argumentsText: string }
  | {
      type: 'tool_end';
      callId: string;
      name: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: 'turn_end'; turn: number; branch: LoopBranch };

export interface LoopResult {
  branch: LoopBranch;
  /** 最终答复文本（handoff/熔断时为已产出的文本） */
  text: string;
  turns: number;
  reason: 'final' | 'handoff' | 'max_turns' | 'aborted' | 'error';
  error?: string;
  messages: ChatMessage[];
}

export interface AgentLoopDeps extends ProviderDeps {
  registry: ToolRegistry;
  /** 工作区根目录（工具执行的边界，必填） */
  workspaceRoot: string;
  permission: PermissionResolver;
  /** 会话级「总是允许」白名单 */
  alwaysAllow?: Set<string>;
  /** 权限模式（W10g 起接入执行路径；不传 = default） */
  mode?: PermissionMode | undefined;
  /** 用户自定义权限规则（allow/deny/ask，按工具名 glob） */
  rules?: ReadonlyArray<PermissionRule>;
  /** 可注入，便于单测（默认用真实 streamChat） */
  chat?: typeof streamChat | undefined;
  /** 可注入，便于单测（默认用真实 runTool） */
  execute?: typeof runTool | undefined;
}

export interface AgentTurnParams {
  connection: { baseUrl: string; apiKey: string; model: string };
  messages: ChatMessage[];
  emit: (event: LoopEvent) => void;
  maxTurns?: number;
  signal?: AbortSignal | undefined;
}

const DEFAULT_MAX_TURNS = 8;

export async function runAgentTurn(
  params: AgentTurnParams,
  deps: AgentLoopDeps,
): Promise<LoopResult> {
  const chat = deps.chat ?? streamChat;
  const execute = deps.execute ?? runTool;
  const maxTurns = Math.max(1, params.maxTurns ?? DEFAULT_MAX_TURNS);
  const messages: ChatMessage[] = [...params.messages];
  const tools = [...deps.registry.toOpenAiTools(), ...toSpecs([handoffTool])];

  let turn = 0;
  let fullText = '';

  while (turn < maxTurns) {
    turn += 1;

    if (params.signal?.aborted) {
      return { branch: 'final', text: fullText, turns: turn, reason: 'aborted', messages };
    }

    // ---- 一轮模型调用（流式） ----
    let calls: AssembledToolCall[] = [];
    let turnText = '';
    let streamError: string | null = null;
    let aborted = false;

    try {
      for await (const ev of chat({
        baseUrl: params.connection.baseUrl,
        apiKey: params.connection.apiKey,
        model: params.connection.model,
        messages,
        tools,
        ...(params.signal ? { signal: params.signal } : {}),
      }) as AsyncGenerator<ProviderEvent>) {
        if (ev.type === 'text_delta') {
          turnText += ev.delta;
          fullText += ev.delta;
          params.emit({ type: 'text_delta', delta: ev.delta });
        } else if (ev.type === 'tool_calls') {
          // 按 index 合并：provider 可能一次性给出全部调用，也可能分多次给出；
          // 直接赋值会在「分多次」时丢掉先到的调用（2026-09-18 单测暴露）
          calls = mergeById(calls, ev.calls);
        } else if (ev.type === 'done') {
          if (ev.reason === 'aborted') aborted = true;
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    }

    if (aborted) {
      return { branch: 'final', text: fullText, turns: turn, reason: 'aborted', messages };
    }
    if (streamError !== null) {
      return {
        branch: 'final',
        text: fullText,
        turns: turn,
        reason: 'error',
        error: streamError,
        messages,
      };
    }

    // ---- 分支一：final（模型没要求工具） ----
    if (calls.length === 0) {
      messages.push({ role: 'assistant', content: turnText });
      params.emit({ type: 'turn_end', turn, branch: 'final' });
      return { branch: 'final', text: fullText, turns: turn, reason: 'final', messages };
    }

    // ---- 分支三：handoff（模型请求移交） ----
    const handoff = calls.find((c) => c.name === HANDOFF_TOOL_NAME);
    if (handoff) {
      messages.push({
        role: 'assistant',
        content: turnText,
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })),
      });
      messages.push({
        role: 'tool',
        toolCallId: handoff.id,
        content: '已记录移交请求，交由上层处理。',
      });
      params.emit({ type: 'turn_end', turn, branch: 'handoff' });
      return { branch: 'handoff', text: fullText, turns: turn, reason: 'handoff', messages };
    }

    // ---- 分支二：tool（串行执行后回传结果） ----
    messages.push({
      role: 'assistant',
      content: turnText,
      toolCalls: calls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })),
    });

    for (const call of calls) {
      params.emit({
        type: 'tool_start',
        callId: call.id,
        name: call.name,
        argumentsText: call.argumentsText,
      });

      const outcome = await executeOne(call, deps, execute);
      messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content });
      params.emit({
        type: 'tool_end',
        callId: call.id,
        name: call.name,
        ok: outcome.ok,
        summary: outcome.content.slice(0, 120),
        durationMs: outcome.durationMs,
      });
    }

    params.emit({ type: 'turn_end', turn, branch: 'tool' });
  }

  // ---- 熔断：达到迭代上界 ----
  return {
    branch: 'final',
    text: fullText,
    turns: turn,
    reason: 'max_turns',
    error: `已达到最大迭代次数（${maxTurns}），已停止。可继续输入以接着处理。`,
    messages,
  };
}

/** 执行单个工具调用，把所有失败都翻译成「可回传模型」的文本 */
async function executeOne(
  call: AssembledToolCall,
  deps: AgentLoopDeps,
  execute: typeof runTool,
): Promise<{ ok: boolean; content: string; durationMs: number }> {
  if (!deps.registry.has(call.name) && call.name !== HANDOFF_TOOL_NAME) {
    return {
      ok: false,
      content: `[tool_not_found] 未注册的工具：${call.name}。可用工具：${deps.registry.names().join(', ')}`,
      durationMs: 0,
    };
  }
  if (call.parseError !== null || call.arguments === null) {
    return {
      ok: false,
      content: `[invalid_args] 工具参数不是合法 JSON（${call.parseError ?? '未知原因'}）。收到的是：${call.argumentsText.slice(0, 200)}`,
      durationMs: 0,
    };
  }

  const tool = call.name === HANDOFF_TOOL_NAME ? handoffTool : deps.registry.get(call.name);
  const result: RunToolResult = await execute(
    tool,
    call.arguments,
    { workspaceRoot: deps.workspaceRoot },
    deps.permission,
    {
      ...(deps.alwaysAllow ? { alwaysAllow: deps.alwaysAllow } : {}),
      // 模式与规则随调用传入：策略层（decideGate）在 W10g 起才真正作用于执行
      ...(deps.mode ? { mode: deps.mode } : {}),
      ...(deps.rules ? { rules: deps.rules } : {}),
    },
  );
  return {
    ok: result.outcome.ok,
    content: result.outcome.content,
    durationMs: result.durationMs,
  };
}

/** 按 index 合并工具调用；同 index 时以「后到」为准（与流式分片语义一致） */
function mergeById(prev: AssembledToolCall[], next: AssembledToolCall[]): AssembledToolCall[] {
  if (prev.length === 0) return [...next];
  const byIndex = new Map<number, AssembledToolCall>();
  for (const c of prev) byIndex.set(c.index, c);
  for (const c of next) byIndex.set(c.index, c);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function toSpecs(tools: ReadonlyArray<StoredTool>): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
