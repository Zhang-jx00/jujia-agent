import { RECENT_TAIL_K } from '@jujia/agent-core';

/**
 * 发给模型的历史怎么窄化、一轮结束后又怎么接回完整记录（6b · 报备 §一/§二，批复②批准）。
 *
 * 放在主进程侧而不是塞进 `chat-service`：后者加载不了进 vitest，
 * 而这里的两条不变量错了代价很高（记账坐标错位 / 摘要被当成用户说的话）。
 */

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

const clampIndex = (n: number, len: number): number => Math.min(Math.max(n, 0), len);

/**
 * 水印之前（落盘行号坐标）的非 system 消息不再发给模型。
 * system 一条都不能少、也不能被替换成摘要 —— 摘要段由 `assembleSystemPrompt` 那一层负责拼，
 * 这里只做"少发"，两处各写一次就会有两个真相。
 */
export function buildModelHistory(all: ModelMessage[], compactedThrough: number): ModelMessage[] {
  const seq = all.filter((m) => m.role !== 'system');
  const from = clampIndex(compactedThrough, seq.length);
  const keep = new Set(seq.slice(from).slice(-RECENT_TAIL_K));
  return all.filter((m) => keep.has(m) || m.role === 'system');
}

/**
 * 一轮结束后接回**完整**历史：只把本轮新增的部分追加上去。
 *
 * 直接 `session.messages = result.messages` 是这一层最容易顺手写错的地方 ——
 * 传进去的是窄化后的窗口，赋值回去就等于把内存里的旧消息剪掉：
 * `session-journal` 按条数算增量，坐标当场错位，而且"原始记录不删"这句承诺也就成了空话。
 */
export function mergeTurnResult(
  full: ModelMessage[],
  outbound: ModelMessage[],
  resultMessages: ModelMessage[],
): ModelMessage[] {
  if (resultMessages.length < outbound.length) {
    // loop 把历史改短了 —— 与我们的假设不符。宁可保守地保留完整记录，也不按长度猜新增区间。
    console.warn(
      `[compact] 模型返回的历史比发出去的还短（${String(resultMessages.length)} < ${String(outbound.length)}），` +
        '按"本轮没有新增"处理，完整历史保持不变',
    );
    return full;
  }
  return [...full, ...resultMessages.slice(outbound.length)];
}
