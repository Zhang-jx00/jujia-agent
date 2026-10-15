/** 模型 provider 的统一抽象（当前实现 OpenAI 兼容协议；Anthropic 档按需追加）。 */
import type { AssembledToolCall } from './tool-call-accumulator';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 多模态的内容段（M11 批一 · R14）：只对 **user** 消息生效，且只活在"本轮出站"的副本上
 * （会话内存与磁盘里的消息永远是纯文本 —— 附件不落盘，报备批复 B）。
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * 出站副本专用：带上它时序列化走 parts 形态（OpenAI 兼容协议）；
   * 其它一切读取方（窗口窄化 / 落盘 / 界面回显）都只看 `content`。
   */
  contentParts?: ChatContentPart[] | undefined;
  /**
   * 会话内存里的**批注**（不发给模型）：本条 user 消息带过几张图。
   * 落盘同行记（`StoredMessage.imageCount`），重启后历史气泡据此显示"[图片未保留 ×N]"。
   */
  imageCount?: number | undefined;
  /**
   * role='tool' 时必填：对应 assistant 消息里 tool_calls[].id。
   * 协议硬约束（卡片 011）：带 tool_calls 的 assistant 消息后必须跟齐对应的 tool 消息，
   * 且 id 必须配对，否则上游直接拒绝。
   */
  toolCallId?: string | undefined;
  /** role='assistant' 且要调用工具时：已完成的调用（用于回传给模型的上下文） */
  toolCalls?: Array<{ id: string; name: string; argumentsText: string }> | undefined;
}

/** 传给模型的工具声明（OpenAI tools[] 形态） */
export interface OpenAiToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface ChatParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** 透传给厂商的可选参数，未设置则用默认 */
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 声明可用工具；**每一轮请求都必须带上**（否则模型不知道还能继续调） */
  tools?: OpenAiToolSpec[] | undefined;
  toolChoice?: 'auto' | 'none' | 'required' | undefined;
}

/**
 * 上游给出的一句话结束原因。
 *
 * 为什么要单列出来（外部审查 T26）：原先这里只有 `'stop' | 'length'`，而厂商实际会给
 * `content_filter`（内容过滤拦腰截断）与各种自造值。**把截断归并成"正常写完"**，
 * 界面上就看不出"回答被截了" —— 用户以为模型答完了，其实是话被掐掉了一半。
 * 未知值一律按 `stop` 收尾（宁可少说一句，不要替厂商编一句）。
 */
export type FinishReason = 'stop' | 'length' | 'content_filter';

/**
 * 这一轮**实际的结束方式**（T55 · R31 定的口径，设计见 `docs/DESIGN-T55-STREAM-END.md`）。
 *
 * `FinishReason` 是"上游自己说它为什么结束"，而这一格是"我们看到它是怎么结束的"——
 * 两者不是一回事：代理的 `proxy_read_timeout` 会 `res.end()` 把流掐了，
 * 上游什么都没说过，而旧实现把"没听说结束"当成"说完了"（`finishReason` 的初值就是 `'stop'`）。
 *
 * `no_end_marker` 的判定口径（**两个结束证据有一个就算写完**）：
 * - 收到 `[DONE]` —— OpenAI 协议规定的收尾标记，**自建端点与网关常常只发这个、从不发 finish_reason**，
 *   把它一律判成截断会让这批厂商直接不可用；
 * - 收到任何 `finish_reason`（含厂商自造的未知值，按 `stop` 收尾，T26 的口径不推翻）；
 * - 两个都没有 → `no_end_marker`：**不许**说成"答完了"，但已经吐出来的字一个字不丢。
 */
export type StreamEnd = FinishReason | 'tool_calls' | 'aborted' | 'no_end_marker';

/**
 * "这一轮的文本没完整交出来"的几种原因（= 除"写完 / 停在工具处 / 用户中止"之外的那些）。
 *
 * 用 `Exclude` 从 `StreamEnd` 推出来而不是另写一遍字面量：将来这里加第三种原因，
 * 循环与界面会自动跟上，不会出现"provider 认得了、界面还在说 stop"的分叉。
 */
export type TruncationReason = Exclude<StreamEnd, 'stop' | 'tool_calls' | 'aborted'>;

/** provider 层面的流式事件（与渲染层的 StreamEvent 解耦，便于单测） */
export type ProviderEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  /** 流结束时（且已拼装完成）一次性给出：分片拼装细节见 tool-call-accumulator.ts */
  | { type: 'tool_calls'; calls: AssembledToolCall[] }
  | { type: 'done'; reason: StreamEnd };

export interface ProviderError extends Error {
  code: 'http_error' | 'network_error' | 'bad_response' | 'timeout';
  status?: number;
}
