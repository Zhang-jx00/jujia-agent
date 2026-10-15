import { runTool, type PermissionResolver, type RunToolResult } from '../tools/executor';
import type { PermissionMode } from '../permissions/policy';
import type { PermissionRule } from '../permissions/rules';
import { noopHookRunner, type HookRunner } from '../hooks/types';
import { stopTurn, userPromptSubmit } from '../hooks/points';
import type { StoredTool } from '../tools/types';
import type { GateAuditInfo } from '../audit/record';
import type { ToolRegistry } from '../tools/registry';
import { streamChat, type ProviderDeps } from '../providers/openai-compat';
import type { AssembledToolCall } from '../providers/tool-call-accumulator';
import type { ChatMessage, ProviderEvent, TruncationReason } from '../providers/types';

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
  /**
   * 长命令的**实时输出**（R8.7 · M4 收尾其三）。
   *
   * 只有工具自己往 `ToolContext.onToolOutput` 交东西时才有这一条（目前是 `run_command`）。
   * 它**不进会话历史、不进模型**：喂给模型的是跑完之后的 `content`。
   * 为什么必须带 `callId`：一次回答里模型可以连着调好几个工具，
   * 不带来源的输出会串到别的气泡上去（外部审查 T5 就是同一个形状）。
   */
  | { type: 'tool_output'; callId: string; name: string; chunk: string }
  | { type: 'turn_end'; turn: number; branch: LoopBranch }
  /**
   * 用量：**整轮累计**，不是单次调用的数字。
   * 一轮里模型可以调好几次工具再回答，逐次上报会让界面只显示最后一段 ——
   * 用户看到的就是"这一轮一共花了多少"。（2026-09-27 接线：契约与界面早就备着，
   * 中间这一层把事件丢了，于是界面的 token 行永远不出现。）
   */
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface LoopResult {
  branch: LoopBranch;
  /** 最终答复文本（handoff/熔断时为已产出的文本） */
  text: string;
  turns: number;
  reason: 'final' | 'handoff' | 'max_turns' | 'aborted' | 'error' | 'hook_blocked';
  error?: string;
  /**
   * **最后一次模型调用**被上游掐断的原因；没被掐就是 null。
   *
   * 为什么单独一格而不塞进 `reason`（外部审查 T26）：`reason` 说的是"循环为什么结束"，
   * 这一格说的是"这段文本本身不完整" —— 一次回答可以同时是"正常收尾但被 length 截断"，
   * 两个事实混在一个枚举里，界面就只能二选一地撒谎。
   * 用 `TruncationReason`（由 `FinishReason` 排除 stop 推出来）而不是再抄一遍字面量：
   * 将来加第三种截断原因，provider / 循环 / 界面会自动跟上，不会出现"provider 认得了、
   * 界面还在说 stop"的分叉。
   */
  truncated: TruncationReason | null;
  /**
   * 回合级钩子（UserPromptSubmit / Stop）这一轮吐出的诊断（T51）。
   *
   * 为什么单独一格而不是塞进 `error`：钩子没跑成**不是这一轮的失败**（契约是 fail-open，
   * 回合照常完成），把它写成 error 等于让一次正常回答变成红色；而完全不写就等于
   * "那道安全检查今天没上班"没人说。空数组是常态，非空才需要在界面上占一格。
   * 设为必填而不是可选：将来给循环加新出口时，漏填会直接编译不过（与 `truncated` 同一条纪律）。
   */
  hookDiagnostics: string[];
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
  /** 高危清单（引擎级兜底，见 RunToolOptions.alwaysAsk） */
  alwaysAsk?: ReadonlyArray<string>;
  /** 生命周期钩子运行器（W5d）；不传 = 没有钩子 */
  hooks?: HookRunner | undefined;
  /** 会话 id：钩子输入里要带上，便于钩子区分会话 */
  sessionId?: string | undefined;
  /** 可注入，便于单测（默认用真实 streamChat） */
  chat?: typeof streamChat | undefined;
  /** 可注入，便于单测（默认用真实 runTool） */
  execute?: typeof runTool | undefined;
  /** 判定事实的出口（执行审计）：原样转给每一次 runTool，不在这里做任何加工 */
  onDecision?: (info: GateAuditInfo) => void;
}

export interface AgentTurnParams {
  connection: { baseUrl: string; apiKey: string; model: string };
  /** 本次用户输入的原文（供 UserPromptSubmit 钩子匹配）；不传则取最后一条 user 消息 */
  promptText?: string | undefined;
  messages: ChatMessage[];
  emit: (event: LoopEvent) => void;
  maxTurns?: number;
  signal?: AbortSignal | undefined;
}

const DEFAULT_MAX_TURNS = 8;

/**
 * Stop 钩子要求再走一步的次数上限。
 * 取 2 而不是 1：一次修正（例如补上测试）通常够用，两次留一点余量；
 * 再往上就不是提醒而是钩子在替模型写作文了，且拖长会话成本。
 */
const MAX_STOP_CONTINUATIONS = 2;

/** 取最后一条 user 消息作为提示词原文（对话服务没显式给 promptText 时的兜底） */
function lastUserText(messages: ReadonlyArray<ChatMessage>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

/**
 * 把钩子给的上下文注入系统提示（而不是塞成一条假的用户消息）。
 * 理由：钩子说的不是用户说的。塞成用户消息会污染会话历史 ——
 * 之后每一轮模型都会以为用户当时说过这句话。
 */
function injectIntoSystem(messages: ChatMessage[], text: string): void {
  const first = messages.findIndex((m) => m.role === 'system');
  if (first >= 0) {
    const current = messages[first];
    const base = typeof current?.content === 'string' ? current.content : '';
    messages[first] = { role: 'system', content: `${base}\n\n${text}` };
    return;
  }
  messages.unshift({ role: 'system', content: text });
}

export async function runAgentTurn(
  params: AgentTurnParams,
  deps: AgentLoopDeps,
): Promise<LoopResult> {
  const chat = deps.chat ?? streamChat;
  const execute = deps.execute ?? runTool;
  const maxTurns = Math.max(1, params.maxTurns ?? DEFAULT_MAX_TURNS);
  const messages: ChatMessage[] = [...params.messages];
  const tools = [...deps.registry.toOpenAiTools(), ...toSpecs([handoffTool])];

  const hooks = deps.hooks ?? noopHookRunner;
  const hookCtx = { sessionId: deps.sessionId ?? 'unknown', cwd: deps.workspaceRoot };
  /**
   * 回合级钩子的诊断收集处（T51）。
   * 两处钩子（UserPromptSubmit / Stop）都往这里交，出口只有一个 —— `LoopResult.hookDiagnostics`。
   * 写在**外面**而不是各 return 前各拼一份：循环有七八条出口，逐条拼迟早漏一条，
   * 而漏的那条正好是"钩子没跑成"这句话（与 `executor.ts` 的 sink 同一条纪律）。
   */
  const hookDiagnostics: string[] = [];

  // ---- 回合级钩子：UserPromptSubmit（发给模型之前） ----
  // 拦下时**一次模型调用都不发生**：这是"钩子能省钱"的地方，也是"钩子能拦住危险提示词"的地方。
  const promptText = params.promptText ?? lastUserText(messages);
  const submit = await userPromptSubmit(hooks, hookCtx, promptText);
  // 拦下与没拦下都要收诊断：被拦下时"另外那条钩子坏了"仍是第二个事实
  hookDiagnostics.push(...submit.diagnostics);
  if (submit.blocked) {
    return {
      branch: 'final',
      text: '',
      turns: 0,
      reason: 'hook_blocked',
      error: submit.reason ?? '这次提示词被钩子拦下了（钩子未给出理由）',
      // 一次模型调用都没发生，所以"没有截断"是**事实**而不是默认值
      truncated: null,
      hookDiagnostics,
      messages,
    };
  }
  if (submit.context !== '') injectIntoSystem(messages, submit.context);

  let turn = 0;
  let fullText = '';
  let usageIn = 0;
  let usageOut = 0;
  /**
   * 最后一次模型调用的截断原因（T26）。每轮调用**之前**归零，所以它总是指向
   * "最近那一次调用"，而不是"这一整轮里曾经有过一次截断" —— 界面要说的是当前这段文本。
   */
  let truncated: TruncationReason | null = null;
  /** Stop 钩子要求"再走一步"的次数：必须有上限，否则钩子写错就是死循环 */
  let stopContinues = 0;

  while (turn < maxTurns) {
    turn += 1;

    if (params.signal?.aborted) {
      return { branch: 'final', text: fullText, turns: turn, reason: 'aborted', truncated, hookDiagnostics, messages };
    }

    // ---- 一轮模型调用（流式） ----
    let calls: AssembledToolCall[] = [];
    let turnText = '';
    let streamError: string | null = null;
    let aborted = false;
    truncated = null;

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
        } else if (ev.type === 'usage') {
          usageIn += ev.inputTokens;
          usageOut += ev.outputTokens;
          params.emit({ type: 'usage', inputTokens: usageIn, outputTokens: usageOut });
        } else if (ev.type === 'tool_calls') {
          // 按 index 合并：provider 可能一次性给出全部调用，也可能分多次给出；
          // 直接赋值会在「分多次」时丢掉先到的调用（2026-09-18 单测暴露）
          calls = mergeById(calls, ev.calls);
        } else if (ev.type === 'done') {
          if (ev.reason === 'aborted') aborted = true;
          // 截断不是"正常写完"（T26）：provider 已经分出 length / content_filter，
          // 这里再归并一次就等于把上面那条修复在这里抹掉
          else if (ev.reason === 'length' || ev.reason === 'content_filter') truncated = ev.reason;
        }
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    }

    if (aborted) {
      return { branch: 'final', text: fullText, turns: turn, reason: 'aborted', truncated, hookDiagnostics, messages };
    }
    if (streamError !== null) {
      return {
        branch: 'final',
        text: fullText,
        turns: turn,
        reason: 'error',
        error: streamError,
        truncated,
        hookDiagnostics,
        messages,
      };
    }

    // ---- 分支一：final（模型没要求工具） ----
    if (calls.length === 0) {
      // ---- 回合级钩子：Stop（一轮准备结束时） ----
      // 钩子可以用 continue:true 要求"再走一步"（例如"你还没跑测试，别急着收工"）。
      // 必须有次数上限：钩子写错（永远返回 continue:true）就成了死循环 —— 这是钩子能拖垮会话的地方。
      const stop = await stopTurn(hooks, hookCtx, turnText);
      // 续走与收工都先收诊断：多次 Stop（上限 3 次）的诊断逐次累加，一条都不覆盖
      hookDiagnostics.push(...stop.diagnostics);
      if (stop.continueTurn && stopContinues < MAX_STOP_CONTINUATIONS) {
        stopContinues += 1;
        messages.push({ role: 'assistant', content: turnText });
        messages.push({
          role: 'user',
          content: stop.context !== '' ? stop.context : '[钩子要求继续]（钩子未给出说明）',
        });
        params.emit({ type: 'turn_end', turn, branch: 'final' });
        continue;
      }

      messages.push({ role: 'assistant', content: turnText });
      params.emit({ type: 'turn_end', turn, branch: 'final' });
      return { branch: 'final', text: fullText, turns: turn, reason: 'final', truncated, hookDiagnostics, messages };
    }

    // ---- 分支三：handoff（模型请求移交） ----
    const handoff = calls.find((c) => c.name === HANDOFF_TOOL_NAME);
    if (handoff) {
      messages.push({
        role: 'assistant',
        content: turnText,
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })),
      });
      /**
       * **每一个** tool_call 都要回一条 tool 消息（外部审查 T10）。
       *
       * 模型可以一次返回多个调用（并行调用是兼容端的常规行为），而这里以前只回 `handoff` 那一条 ——
       * 于是同时坏掉两件事：
       *   ① 破本文件头部的硬约束④：下一轮续聊时上游按"assistant 的每个 tool_call id 都要有回复"校验，
       *      少一条就是 400，这个会话的历史当场作废；
       *   ② 其余那几个调用**静默消失**：没执行、没告诉模型、也没告诉用户。
       *
       * 处置选**补齐**而不是剥离：剥离要改的是 assistant 那条消息本身 —— 那是"模型请求了什么"的记录，
       * 把它删成"只问了 handoff"等于把历史改成我们希望的样子，界面与审计跟着一起失真。
       * 而且"跑不了就用一条 tool 消息把原因说清楚"是本文件已有的成例
       * （`executeOne` 对 `[tool_not_found]` / `[invalid_args]` 就是这么办的），不是新发明的规矩。
       */
      for (const call of calls) {
        const isHandoffCall = call.name === HANDOFF_TOOL_NAME;
        const content = isHandoffCall
          ? '已记录移交请求，交由上层处理。'
          : `[未执行] 本轮以 handoff 收尾，${call.name} 没有运行（移交优先于其余调用）。` +
            '若确实需要这个结果，请在移交之后重新发起。';
        params.emit({
          type: 'tool_start',
          callId: call.id,
          name: call.name,
          argumentsText: call.argumentsText,
        });
        messages.push({ role: 'tool', toolCallId: call.id, content });
        params.emit({
          type: 'tool_end',
          callId: call.id,
          name: call.name,
          ok: isHandoffCall,
          summary: content.slice(0, 120),
          durationMs: 0,
        });
      }
      params.emit({ type: 'turn_end', turn, branch: 'handoff' });
      return { branch: 'handoff', text: fullText, turns: turn, reason: 'handoff', truncated, hookDiagnostics, messages };
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

      const outcome = await executeOne(call, deps, execute, (text) => {
        // 空块不发：一次空事件会让界面多一次重绘，而"没有输出"不是输出
        if (text === '') return;
        params.emit({ type: 'tool_output', callId: call.id, name: call.name, chunk: text });
      });
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
    truncated,
    hookDiagnostics,
    messages,
  };
}

/** 执行单个工具调用，把所有失败都翻译成「可回传模型」的文本 */
async function executeOne(
  call: AssembledToolCall,
  deps: AgentLoopDeps,
  execute: typeof runTool,
  onOutput: (text: string) => void,
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
    // 实时输出通道：谁在跑就用谁的 callId 标出去，循环不在这里加工内容
    { workspaceRoot: deps.workspaceRoot, onToolOutput: onOutput },
    deps.permission,
    {
      ...(deps.alwaysAllow ? { alwaysAllow: deps.alwaysAllow } : {}),
      // 模式与规则随调用传入：策略层（decideGate）在 W10g 起才真正作用于执行
      ...(deps.mode ? { mode: deps.mode } : {}),
      ...(deps.rules ? { rules: deps.rules } : {}),
      ...(deps.alwaysAsk ? { alwaysAsk: deps.alwaysAsk } : {}),
      ...(deps.hooks ? { hooks: deps.hooks } : {}),
      ...(deps.sessionId ? { sessionId: deps.sessionId } : {}),
      ...(deps.onDecision ? { onDecision: deps.onDecision } : {}),
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
