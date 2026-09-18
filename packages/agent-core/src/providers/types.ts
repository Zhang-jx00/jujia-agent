/** 模型 provider 的统一抽象（W2 只实现 OpenAI 兼容协议；Anthropic 档在 W3+ 补）。 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
}

/** provider 层面的流式事件（与渲染层的 StreamEvent 解耦，便于单测） */
export type ProviderEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; reason: 'stop' | 'length' | 'aborted' };

export interface ProviderError extends Error {
  code: 'http_error' | 'network_error' | 'bad_response' | 'timeout';
  status?: number;
}
