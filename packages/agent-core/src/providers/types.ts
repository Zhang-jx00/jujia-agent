/** 模型 provider 的统一抽象（当前实现 OpenAI 兼容协议；Anthropic 档按需追加）。 */
import type { AssembledToolCall } from './tool-call-accumulator';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
 * "这一轮的文本被上游掐了"的两种原因（= 除 stop 之外的结束原因）。
 *
 * 用 `Exclude` 从 `FinishReason` 推出来而不是另写一遍字面量：将来这里加第三种原因，
 * 循环与界面会自动跟上，不会出现"provider 认得了、界面还在说 stop"的分叉。
 */
export type TruncationReason = Exclude<FinishReason, 'stop'>;

/** provider 层面的流式事件（与渲染层的 StreamEvent 解耦，便于单测） */
export type ProviderEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  /** 流结束时（且已拼装完成）一次性给出：分片拼装细节见 tool-call-accumulator.ts */
  | { type: 'tool_calls'; calls: AssembledToolCall[] }
  | { type: 'done'; reason: FinishReason | 'aborted' | 'tool_calls' };

export interface ProviderError extends Error {
  code: 'http_error' | 'network_error' | 'bad_response' | 'timeout';
  status?: number;
}
