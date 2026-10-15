import { maskSecrets } from '../audit/redact';
import { createSseParser } from './sse';
import { ToolCallAccumulator, type AssembledToolCall } from './tool-call-accumulator';
import type {
  ChatMessage,
  ChatParams,
  FinishReason,
  ProviderError,
  ProviderEvent,
  StreamEnd,
} from './types';

/** 可注入的依赖，便于单测打桩（默认用全局 fetch） */
export interface ProviderDeps {
  fetcher?: typeof fetch;
  /**
   * 流式读取的**空闲超时**与**单次调用总时长**（毫秒）。
   * 刻意放在 deps 而不是 params：它们是本应用的运行时策略，不是发给厂商的请求参数；
   * 放在 params 会让它们看起来像协议字段。
   */
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
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
 * 把"被时间掐断"翻成可区分的错误；没掐断返回 null（交给调用方继续按"用户中止"处理）。
 * 单独成一个函数是因为 streamChat 有**两个** catch 点（连不上 / 读到一半），
 * 两处必须给同一套说法——写两遍就会有一天只改一遍。
 */
function stuckError(
  clock: ReturnType<typeof createStreamTimeout>,
  idleMs: number,
  totalMs: number,
): ProviderError | null {
  if (clock.idleExceeded()) {
    return makeError(
      'timeout',
      `上游 ${String(Math.round(idleMs / 1000))} 秒没有再吐字，已断开（已收到的内容不完整，可重试）`,
    );
  }
  if (clock.totalExceeded()) {
    return makeError(
      'timeout',
      `单次模型调用超过 ${String(Math.round(totalMs / 1000))} 秒，已断开（可重试）`,
    );
  }
  return null;
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

/**
 * 流式读取的**空闲超时**（默认值）：两次数据之间最长允许隔多久。
 *
 * 为什么是"空闲"而不是"总时长"（2026-09-27 外部审查 T7）：
 * 总时长一刀切会**误伤正常的长轮** —— 传进来的信号覆盖的是**整轮**（含工具执行、
 * 含用户在审批弹窗上思考的时间），所以一个 5 分钟的总上限会掐掉本来好端端的轮次。
 * 而真正要防的是"上游 200 之后不再吐字"，那种情况的特征正好是**一段时间没有新数据**，
 * 所以按空闲判既更准、也不会伤到健康连接。
 */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

/**
 * 单次模型调用的总时长上限（默认值）。
 * 口径与 `createStreamTimeout` 的注释一致：**按调用算，不按整轮算** ——
 * 工具执行与用户在审批弹窗上的思考时间都不该占模型的预算。
 */
const STREAM_TOTAL_TIMEOUT_MS = 300_000;

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
  /**
   * 空闲超时（T7）。与调用方给的 signal **合并**：任一方触发都会断开 fetch，
   * 但两者的**后果不同** —— 空闲超时报错并可重试，调用方中止是正常结束。
   */
  const idleMs = deps.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
  const totalMs = deps.totalTimeoutMs ?? STREAM_TOTAL_TIMEOUT_MS;
  const clock = createStreamTimeout({ idleMs, totalMs });
  const signal = params.signal ? AbortSignal.any([params.signal, clock.signal]) : clock.signal;

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
      signal,
    });
  } catch (err) {
    // 连"响应头都没等到"也在空闲/总限的管辖之内；这一支必须判在 isAbort **之前**，
    // 否则会被下面的分支当成"用户点了停止"
    const stuck = stuckError(clock, idleMs, totalMs);
    if (stuck !== null) throw stuck;
    if (isAbort(err)) {
      yield { type: 'done', reason: 'aborted' };
      return;
    }
    if (isTimeout(err)) {
      throw makeError('timeout', '上游在超时时间内没有响应（可在设置中调大超时）');
    }
    throw makeError('network_error', `连接失败：${presentable(causeText(err), 300)}`);
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
  const ledger: StreamLedger = { deltas: 0, garbage: 0, answered: 0, usage: 0 };
  let finishReason: FinishReason = 'stop';
  let wantsTools = false;
  /**
   * 两个**结束证据**（T55 · R31）。旧实现只有上面那行 `finishReason = 'stop'` 的初值，
   * 全文没有任何一处记录"到底有没有收到过结束标记" —— 于是代理 `res.end()` 掐掉的半截回答
   * 一路顶着 `'stop'` 出去，界面显示成"答完了"（这就是 T55 的病根）。
   *
   * 为什么是**两个**布尔而不是一个：`[DONE]` 与 `finish_reason` 是两个独立的收尾约定，
   * 自建端点常只发前者、也有网关发完 finish_reason 就直接关连接。
   * 口径见 `types.ts` 的 `StreamEnd` 注释与 `docs/DESIGN-T55-STREAM-END.md`。
   */
  let sawFinishReason = false;
  let sawDoneMarker = false;

  /**
   * 这一轮到底是怎么结束的（判定收在**一处**，两条收尾路径共用 —— 写两遍迟早只改一遍）。
   *
   * 顺序有讲究（T56 的接缝）：**先问"有没有结束证据"，再问"有没有工具调用"**。
   * 反过来写会让 `hasCalls()` 抢先把结论定成 `tool_calls`，于是"网关发了个空参数的调用就断流"
   * 这一种形状又拿到了"有结束标记"的待遇 —— 拼装器据此放行 `{}`，T56 的洞原样留着。
   */
  const endOfStream = (): StreamEnd => {
    if (!sawFinishReason && !sawDoneMarker) return 'no_end_marker';
    if (toolCalls.hasCalls()) return 'tool_calls';
    return finishReason;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // 续命：只要还在吐数据就不算卡住（变异 M33 摘掉这一行，长流会被空闲超时误杀）
      clock.beat();
      const text = decoder.decode(value, { stream: true });
      for (const payload of parser.push(text)) {
        const mapped = mapPayload(
          payload,
          ledger,
          (r) => {
            finishReason = r;
            sawFinishReason = true;
          },
          toolCalls,
          () => {
            wantsTools = true;
            sawFinishReason = true; // `finish_reason:'tool_calls'` 同样是一个结束标记
          },
        );
        // 一帧里可以同时有正文与 usage（T27）：逐个产出，不能只取第一个
        for (const ev of mapped.events) yield ev;
        if (mapped.done) {
          sawDoneMarker = true;
          // 先判"这一轮到底有没有产出"（T25），再收尾
          assertProduced(ledger, toolCalls);
          // 先吐出拼装好的工具调用，再结束：顺序对调用方很重要
          for (const ev of emitToolCallsIfAny(toolCalls, wantsTools, endOfStream())) yield ev;
          yield { type: 'done', reason: endOfStream() };
          return;
        }
      }
    }

    // 流被服务端直接关闭（没有 [DONE]）时，flush 出最后一个事件
    for (const payload of parser.flush()) {
      const mapped = mapPayload(
        payload,
        ledger,
        (r) => {
          finishReason = r;
          sawFinishReason = true;
        },
        toolCalls,
        () => {
          wantsTools = true;
          sawFinishReason = true;
        },
      );
      for (const ev of mapped.events) yield ev;
      if (mapped.done) {
        sawDoneMarker = true;
        break;
      }
    }

    // 与 [DONE] 那条路**同一个判据**（T25）：两条收尾路径不能各写一份"算不算成功"
    assertProduced(ledger, toolCalls);
    for (const ev of emitToolCallsIfAny(toolCalls, wantsTools, endOfStream())) yield ev;
    yield { type: 'done', reason: endOfStream() };
  } catch (err) {
    // 顺序有讲究：两种超时**必须判在 isAbort 之前**（三者都是 AbortError，混了就等于误报）
    const stuck = stuckError(clock, idleMs, totalMs);
    if (stuck !== null) throw stuck;
    if (isAbort(err)) {
      yield { type: 'done', reason: 'aborted' };
      return;
    }
    if (isTimeout(err)) {
      throw makeError('timeout', '上游在超时时间内没有响应（可在设置中调大超时）');
    }
    if (isProviderError(err)) throw err;
    throw makeError('network_error', `流读取中断：${presentable(causeText(err), 300)}`);
  } finally {
    // T57①：三条早退路径（[DONE] 收尾 / 中止 / 抛错）以前都只 `releaseLock()`，
    // 上游连接留在池里直到它自己关。`releaseLock()` 只是"我不再读"，
    // **cancel() 才是"这条流我不要了"**；已经读完的流上 cancel 是空操作，所以放 finally 一处收口。
    // 失败不许盖掉真正的退出原因（清理动作报错从来不是本轮要告诉用户的那件事）。
    await reader.cancel().catch(() => undefined);
    reader.releaseLock?.();
    clock.dispose();
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
  // M11：user 消息带 parts 时走多模态形态（只可能在出站副本上出现，见 ChatMessage 注释）
  return { role: m.role, content: m.contentParts ?? m.content };
}

/** 有工具调用就产出事件（放在 done 之前） */
function* emitToolCallsIfAny(
  acc: ToolCallAccumulator,
  wantsTools: boolean,
  end: StreamEnd,
): Generator<ProviderEvent> {
  if (!acc.hasCalls()) return;
  // T56：把"流到底是怎么结束的"交给拼装器 —— 它以前什么都不知道，
  // 于是"参数还没送到"与"这个工具本来无参"两种情况被当成同一件事。
  const calls: AssembledToolCall[] = acc.finish(end);
  if (calls.length > 0 || wantsTools) {
    yield { type: 'tool_calls', calls };
  }
}

/**
 * 一轮流式的**产出账本**（外部审查 T25）。
 *
 * 为什么要分开记这几格：判"这一轮到底有没有拿到东西"不能只看"有没有收到帧" ——
 * 上游可以在 HTTP 200 之后只吐无法解析的垃圾，或干脆只给一个 `[DONE]`。
 * 两种情况的**说法不一样**（一种是"上游在胡说"，一种是"上游什么都没写"），
 * 而"收到过几个垃圾"与"收到过几个空负载"混成一格就分不出这两句话。
 */
interface StreamLedger {
  /** 正文增量条数 */
  deltas: number;
  /** 解析失败的负载数 */
  garbage: number;
  /** 带 choices 且解析成功的负载数（证明上游真的在答） */
  answered: number;
  /** usage 事件数（有的网关只给 usage 不给正文） */
  usage: number;
}

/**
 * "拿到 [DONE]"不等于"拿到回答"（T25）。
 *
 * 修之前的形状：`bad_response` 兜底只写在**没有 [DONE]**的那条收尾路径上，
 * 于是"全是垃圾负载 + 正常收尾"的流被当成一次**成功的空回答** —— 界面画出一条什么都没有的消息，
 * 账记成成功，用户丢了一段对话还不知道为什么。判断只写在这一处，两条收尾路径都调它。
 */
function assertProduced(ledger: StreamLedger, toolCalls: ToolCallAccumulator): void {
  if (ledger.deltas > 0 || ledger.answered > 0 || ledger.usage > 0 || toolCalls.hasCalls()) return;
  if (ledger.garbage > 0) {
    throw makeError('bad_response', `收到 ${String(ledger.garbage)} 个无法解析的负载，且没有任何内容`);
  }
  throw makeError('bad_response', '上游结束了这次流式响应，但没有给出任何内容（一个数据负载都没有）');
}

/** 解析单条 data 负载的产物：一次可以给出**多个**事件（T27），以及是否收到 [DONE] */
interface MappedPayload {
  events: ProviderEvent[];
  done: boolean;
}

/** 解析单条 data 负载 */
function mapPayload(
  payload: string,
  ledger: StreamLedger,
  onFinish: (r: FinishReason) => void,
  toolCalls: ToolCallAccumulator,
  onToolCalls: () => void,
): MappedPayload {
  const events: ProviderEvent[] = [];
  const trimmed = payload.trim();
  if (trimmed === '') return { events, done: false };
  if (trimmed === '[DONE]') return { events, done: true };

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    ledger.garbage += 1;
    // T48：日志也不能留原文（打包后日志会落文件，文件会被贴进 issue）
    console.warn('[provider] 跳过无法解析的 SSE 负载:', presentable(trimmed, 120));
    return { events, done: false };
  }

  // 部分厂商用 data 里带 error 的形式报错
  if (json['error']) {
    const msg = typeof json['error'] === 'object' && json['error'] !== null
      ? JSON.stringify(json['error'])
      : String(json['error']);
    throw makeError('bad_response', `上游返回错误：${presentable(msg, 300)}`);
  }

  const choices = json['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    ledger.answered += 1;
    const first = choices[0] as Record<string, unknown>;
    const reason = first['finish_reason'];
    // 结束原因**照原样传**（T26）：length / content_filter 是"话被掐了"，
    // 与 stop 不是一回事；厂商自造的未知值不猜意思，按 stop 收尾。
    if (reason === 'tool_calls') onToolCalls();
    else if (reason === 'length') onFinish('length');
    else if (reason === 'content_filter') onFinish('content_filter');
    else if (typeof reason === 'string') onFinish('stop');

    const delta = first['delta'] as Record<string, unknown> | undefined;
    // 首帧通常只有 role、没有 content（卡片 011 第 4 条）
    const rawToolCalls = delta?.['tool_calls'];
    if (Array.isArray(rawToolCalls)) {
      toolCalls.push(rawToolCalls as never);
    }

    const content = delta?.['content'];
    if (typeof content === 'string' && content.length > 0) {
      ledger.deltas += 1;
      events.push({ type: 'text_delta', delta: content });
    }
  }

  // usage 常在**最后一帧**与正文一起给。原先这里在 text_delta 分支就 return 了，
  // 于是这种厂商的 token 数全部丢在这里、整轮累计跟着偏小（T27）——
  // 现在两个事件一起返回，谁先到都不挡谁。
  const usage = json['usage'] as Record<string, unknown> | undefined;
  if (usage) {
    const input = Number(usage['prompt_tokens'] ?? usage['input_tokens'] ?? 0);
    const output = Number(usage['completion_tokens'] ?? usage['output_tokens'] ?? 0);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      ledger.usage += 1;
      events.push({ type: 'usage', inputTokens: input, outputTokens: output });
    }
  }

  return { events, done: false };
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

/**
 * 错误的**可展示文本**（T57② · R31）。
 *
 * 为什么不是 `errText`：Node/undici 在网络层给的是包装错误 —— `TypeError: fetch failed`，
 * 而**真原因在 `cause` 上**（`ECONNREFUSED` / `CERT_HAS_EXPIRED` / `ENOTFOUND` / `SocketError`）。
 * 判定链早就顺着 `cause` 走四层（`nameChain` / `codeChain`），**文案却没走** ——
 * 于是连不上、证书过期、DNS 失败、被连接池踢这在界面上是同一句"连接失败：fetch failed"，
 * 用户完全无法据此排查（这是"后果盖掉事实"的同族：**判对了却没说出来**）。
 *
 * 三条克制：① 原话一个字不丢（真原因**追加**在括号里，不是替换）；
 * ② 去重（`cause.message` 常常就是 head 那句）；③ 仍然过 `presentable`（剔密 + 截上界），
 * 与上游正文同一道闸 —— 密钥不进渲染层是第一条红线，不因"这是本地错误"而豁免。
 */
function causeText(err: unknown): string {
  const head = errText(err);
  const seen = new Set<string>([head]);
  const chain: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur !== null && typeof cur === 'object'; i += 1) {
    const node = cur as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof node.code === 'string' || typeof node.code === 'number' ? String(node.code) : null;
    // '23' 是 Node 的 TimeoutError 标记，已经被 `isTimeout` 那条分支单独说过了，不再重复
    if (code !== null && code !== '' && code !== '23' && !seen.has(code)) {
      chain.push(code);
      seen.add(code);
    }
    const message = typeof node.message === 'string' ? node.message.trim() : '';
    if (message !== '' && !seen.has(message)) {
      chain.push(message);
      seen.add(message);
    }
    cur = node.cause;
  }
  return chain.length === 0 ? head : `${head}（原因链：${chain.join(' → ')}）`;
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return presentable(text, 300);
  } catch {
    return '';
  }
}

/**
 * 上游原文的「可展示形态」（T48）：先按审计那张表剔密，再折空白、截上界。
 *
 * **为什么在这儿剔，而不是等界面剔**：这条字符串会进 `ProviderError.message` →
 * `LoopResult.error` → `error` 事件 → 渲染层气泡，而本仓第一条红线是密钥不进渲染层。
 * 不少网关（含自建代理）会把整条 `Authorization` 回显在 401 正文里 ——
 * 一次鉴权失败就能把密钥显示在聊天窗口里，并随对话历史落盘。
 * **顺序是「剔完再截」**：先截可能把 `Bearer xxxx` 切成半截，正则认不出来，密钥反而漏出去。
 * 剔了几处要写在消息里（静默替换等于"这条看起来是原文"，是另一种撒谎）。
 */
function presentable(raw: string, cap: number): string {
  const { text, hits } = maskSecrets(raw.replace(/\s+/g, ' '));
  const clipped = text.length > cap ? `${text.slice(0, cap)}…` : text;
  return hits.length > 0 ? `${clipped}（${String(hits.length)} 处疑似密钥已隐去）` : clipped;
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
    throw makeError('network_error', `连接失败：${presentable(causeText(err), 300)}`);
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

/**
 * 一次模型调用的两条时间界限（2026-09-27 外部审查 T7 重写）。
 *
 * - **空闲**（`idleMs`）：两次数据之间最长隔多久。这是"上游卡住"的真实特征，
 *   每次 `beat()` 续命，所以健康但较长的流不会被误杀。
 * - **总时长**（`totalMs`）：同一次模型调用的上限，兜住"每 50 秒吐一个字地吊着"这种
 *   既不算卡死也不算健康的流。复核 002 定过"必须保持有界"，这条就是那一界的**正确落点** ——
 *   它以前挂在**整轮**上（`chat-service` 传 5 分钟总超时进 agent-loop），
 *   于是连"工具跑了一半"与"用户还在审批弹窗上想"都被算进模型的预算里，属于误伤。
 *
 * 为什么要区分 `idleExceeded()` 与 `aborted()`：三者都表现为 `AbortError`，
 * 混为一谈就会把"上游卡死"显示成"用户点了停止"—— 那是本项目最忌讳的**静默失败**形状。
 */
export function createStreamTimeout(input: {
  idleMs: number;
  totalMs: number;
}): {
  readonly signal: AbortSignal;
  beat(): void;
  idleExceeded(): boolean;
  totalExceeded(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let idleFired = false;
  let totalFired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (idleFired) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      idleFired = true;
      controller.abort(new Error(`上游 ${Math.round(input.idleMs / 1000)} 秒没有再吐字`));
    }, input.idleMs);
    timer.unref?.();
  };
  arm();
  const totalTimer = setTimeout(() => {
    totalFired = true;
    controller.abort(new Error(`单次模型调用超过 ${Math.round(input.totalMs / 1000)} 秒`));
  }, input.totalMs);
  totalTimer.unref?.();

  return {
    signal: controller.signal,
    beat: arm,
    idleExceeded: () => idleFired,
    totalExceeded: () => totalFired,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      clearTimeout(totalTimer);
    },
  };
}
