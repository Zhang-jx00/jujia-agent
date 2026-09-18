import { createSseParser } from './sse';
import { ToolCallAccumulator, type AssembledToolCall } from './tool-call-accumulator';
import type { ChatMessage, ChatParams, ProviderError, ProviderEvent } from './types';

/** 可注入的依赖，便于单测打桩（默认用全局 fetch） */
export interface ProviderDeps {
  fetcher?: typeof fetch;
}

function makeError(
  code: ProviderError['code'],
  message: string,
  status?: number,
): ProviderError {
  const err = new Error(message) as ProviderError;
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

/**
 * 归一化 baseUrl：
 * - 去掉末尾斜杠
 * - 若未包含 `/v1`，补上（DeepSeek/GLM/OpenAI 的 OpenAI 兼容端点都在 /v1 下）
 * - 若用户已经填了完整路径（含 /chat/completions），则原样使用
 */
export function resolveEndpoint(baseUrl: string, path: 'chat/completions' | 'models'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions') || trimmed.endsWith('/models')) {
    return trimmed.replace(/\/(chat\/completions|models)$/, `/${path}`);
  }
  const withVersion = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${withVersion}/${path}`;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * OpenAI 兼容协议的流式对话。
 *
 * 契约：正常结束一定产出一次 `done`；HTTP/网络错误抛 ProviderError；
 * 用户中止（AbortSignal）产出 `done(aborted)` 而不是抛错——中止是正常路径，不是异常。
 */
export async function* streamChat(
  params: ChatParams,
  deps: ProviderDeps = {},
): AsyncGenerator<ProviderEvent> {
  const doFetch = deps.fetcher ?? fetch;
  const url = resolveEndpoint(params.baseUrl, 'chat/completions');

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map(serializeMessage),
    stream: true,
  };
  if (params.temperature !== undefined) body['temperature'] = params.temperature;
  if (params.maxTokens !== undefined) body['max_tokens'] = params.maxTokens;
  // 每一轮都要带 tools（协议硬约束，卡片 011）
  if (params.tools && params.tools.length > 0) {
    body['tools'] = params.tools;
    body['tool_choice'] = params.toolChoice ?? 'auto';
  }

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (err) {
    if (isAbort(err)) {
      yield { type: 'done', reason: 'aborted' };
      return;
    }
    if (isTimeout(err)) {
      throw makeError('timeout', '上游在超时时间内没有响应（可在设置中调大超时）');
    }
    throw makeError('network_error', `连接失败：${errText(err)}`);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    throw makeError('http_error', `HTTP ${res.status}${detail ? `：${detail}` : ''}`, res.status);
  }
  if (!res.body) {
    throw makeError('bad_response', '响应没有 body，无法流式读取');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = createSseParser();
  const toolCalls = new ToolCallAccumulator();
  let finishReason: 'stop' | 'length' = 'stop';
  let wantsTools = false;
  let received = 0;
  let skipped = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const payload of parser.push(text)) {
        const mapped = mapPayload(
          payload,
          (r) => {
            finishReason = r;
          },
          toolCalls,
          () => {
            wantsTools = true;
          },
        );
        if (mapped === 'done') {
          // 先吐出拼装好的工具调用，再结束：顺序对调用方很重要
          for (const ev of emitToolCallsIfAny(toolCalls, wantsTools)) yield ev;
          yield {
            type: 'done',
            reason: toolCalls.hasCalls() ? 'tool_calls' : finishReason,
          };
          return;
        }
        if (mapped === 'skip') {
          skipped += 1;
          continue;
        }
        if (mapped.type === 'text_delta' && mapped.delta.length > 0) received += 1;
        yield mapped;
      }
    }

    // 流被服务端直接关闭（没有 [DONE]）时，flush 出最后一个事件
    for (const payload of parser.flush()) {
      const mapped = mapPayload(
        payload,
        (r) => {
          finishReason = r;
        },
        toolCalls,
        () => {
          wantsTools = true;
        },
      );
      if (mapped === 'done') break;
      if (mapped !== 'skip') yield mapped;
    }

    // 只有垃圾负载且没有工具调用 → 视为上游异常（不能静默成功）
    if (received === 0 && skipped > 0 && !toolCalls.hasCalls()) {
      throw makeError('bad_response', `收到 ${skipped} 个无法解析的负载，且没有任何文本增量`);
    }
    for (const ev of emitToolCallsIfAny(toolCalls, wantsTools)) yield ev;
    yield { type: 'done', reason: toolCalls.hasCalls() ? 'tool_calls' : finishReason };
  } catch (err) {
    if (isAbort(err)) {
      yield { type: 'done', reason: 'aborted' };
      return;
    }
    if (isTimeout(err)) {
      throw makeError('timeout', '上游在超时时间内没有响应（可在设置中调大超时）');
    }
    if (isProviderError(err)) throw err;
    throw makeError('network_error', `流读取中断：${errText(err)}`);
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * 把消息序列化为协议要求的形态。
 * 重点：assistant 带工具调用时必须回传 tool_calls，tool 消息必须带配对的 tool_call_id。
 */
function serializeMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
  }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content === '' ? null : m.content,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.argumentsText },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

/** 有工具调用就产出事件（放在 done 之前） */
function* emitToolCallsIfAny(
  acc: ToolCallAccumulator,
  wantsTools: boolean,
): Generator<ProviderEvent> {
  if (!acc.hasCalls()) return;
  const calls: AssembledToolCall[] = acc.finish();
  if (calls.length > 0 || wantsTools) {
    yield { type: 'tool_calls', calls };
  }
}

/** 解析单条 data 负载；返回 ProviderEvent、'done'、或 'skip' */
function mapPayload(
  payload: string,
  onFinish: (r: 'stop' | 'length') => void,
  toolCalls: ToolCallAccumulator,
  onToolCalls: () => void,
): ProviderEvent | 'done' | 'skip' {
  const trimmed = payload.trim();
  if (trimmed === '') return 'skip';
  if (trimmed === '[DONE]') return 'done';

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    console.warn('[provider] 跳过无法解析的 SSE 负载:', trimmed.slice(0, 120));
    return 'skip';
  }

  // 部分厂商用 data 里带 error 的形式报错
  if (json['error']) {
    const msg = typeof json['error'] === 'object' && json['error'] !== null
      ? JSON.stringify(json['error'])
      : String(json['error']);
    throw makeError('bad_response', `上游返回错误：${msg}`);
  }

  const choices = json['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const reason = first['finish_reason'];
    if (reason === 'tool_calls') onToolCalls();
    else if (reason === 'length') onFinish('length');
    else if (typeof reason === 'string') onFinish('stop');

    const delta = first['delta'] as Record<string, unknown> | undefined;
    // 首帧通常只有 role、没有 content（卡片 011 第 4 条）
    const rawToolCalls = delta?.['tool_calls'];
    if (Array.isArray(rawToolCalls)) {
      toolCalls.push(rawToolCalls as never);
    }

    const content = delta?.['content'];
    if (typeof content === 'string' && content.length > 0) {
      return { type: 'text_delta', delta: content };
    }
  }

  const usage = json['usage'] as Record<string, unknown> | undefined;
  if (usage) {
    const input = Number(usage['prompt_tokens'] ?? usage['input_tokens'] ?? 0);
    const output = Number(usage['completion_tokens'] ?? usage['output_tokens'] ?? 0);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      return { type: 'usage', inputTokens: input, outputTokens: output };
    }
  }

  return 'skip';
}

function isAbort(err: unknown): boolean {
  return nameChain(err).includes('AbortError') || codeChain(err).includes('ABORT_ERR');
}

/**
 * 超时判定。
 *
 * 复核 002 实测（2026-09-18）：Node 的 `AbortSignal.timeout()` 抛出的是
 * **`TimeoutError`**（`code = 23`），并不是 `AbortError`。
 * 初版 `isAbort` 只认后者，导致「上游长时间无响应」被误报成 `network_error`——
 * 用户会看到「连接失败」，而真相是「上游超时」。故单独判定，并给出可区分的错误语义。
 */
function isTimeout(err: unknown): boolean {
  return nameChain(err).includes('TimeoutError') || codeChain(err).includes('23');
}

/** 错误对象及其 cause 链上的 name 集合（undici 有时把真实原因包在 cause 里） */
function nameChain(err: unknown): string[] {
  const out: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    const name = (cur as { name?: unknown }).name;
    if (typeof name === 'string') out.push(name);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

function codeChain(err: unknown): string[] {
  const out: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') out.push(String(code));
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

function isProviderError(err: unknown): err is ProviderError {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    return '';
  }
}

/** 连接测试：拉取模型列表（OpenAI 兼容端点普遍支持 GET /models） */
export async function listModels(
  params: { baseUrl: string; apiKey: string; signal?: AbortSignal },
  deps: ProviderDeps = {},
): Promise<string[]> {
  const doFetch = deps.fetcher ?? fetch;
  const url = resolveEndpoint(params.baseUrl, 'models');

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' },
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (err) {
    if (isAbort(err)) throw makeError('network_error', '请求被取消');
    if (isTimeout(err)) throw makeError('timeout', '上游在超时时间内没有响应');
    throw makeError('network_error', `连接失败：${errText(err)}`);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    throw makeError('http_error', `HTTP ${res.status}${detail ? `：${detail}` : ''}`, res.status);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const data = json['data'];
  if (!Array.isArray(data)) throw makeError('bad_response', '返回结构中没有模型列表 data[]');
  return data
    .map((item) => (item as Record<string, unknown>)['id'])
    .filter((id): id is string => typeof id === 'string')
    .sort();
}

/** 给 UI 用的默认超时保障：外部 signal 与超时合并 */
export function withTimeout(signal: AbortSignal | undefined, ms = DEFAULT_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}
