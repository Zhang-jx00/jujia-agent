import { createToolOutputStream, type ToolOutputStream } from '@jujia/agent-core';

/**
 * 实时输出的**按调用分线**中转（R8.7 · M4 收尾其三）。
 *
 * 一轮回答里模型可以连着调好几个工具，每一次调用的输出必须回到**它自己**的尾巴上，
 * 并且在这一次调用结束、整轮结束（含用户中途停止）时都把压着的那批尾巴补发出去。
 *
 * 为什么单独一层：`chat-service` 依赖 electron、进不了 vitest。
 * 判据与状态机长在可测的层里，胶水只做胶水 —— 这是本仓一贯的做法，
 * 否则"漏了一次 closeAll"这种错只有等 e2e 或线上才能发现。
 */

export interface ToolOutputRelayOptions {
  /** 保留在尾部的字符上限（同时是单条事件的大小上限） */
  maxTailChars: number;
  /** 攒够多少个字符发一份快照（字节上界） */
  flushChars: number;
  /** 静默多久先发一份（时间上界）—— 没有它，"先吐两行然后安静半分钟"全程看不见 */
  quietMs?: number | undefined;
  /** 交出一份尾部快照 */
  pushTail: (callId: string, name: string, tail: string) => void;
}

export interface ToolOutputRelay {
  onChunk(callId: string, name: string, chunk: string): void;
  onEnd(callId: string): void;
  closeAll(): void;
}

export function createToolOutputRelay(options: ToolOutputRelayOptions): ToolOutputRelay {
  /** callId → 这条线的尾部状态。Map 的插入顺序 = 调用顺序，closeAll 按它补发 */
  const streams = new Map<string, ToolOutputStream>();

  return {
    onChunk(callId, name, chunk) {
      let stream = streams.get(callId);
      if (stream === undefined) {
        stream = createToolOutputStream({
          maxTailChars: options.maxTailChars,
          flushChars: options.flushChars,
          ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
          pushTail: (tail) => options.pushTail(callId, name, tail),
        });
        streams.set(callId, stream);
      }
      stream.feed(chunk);
    },

    onEnd(callId) {
      const stream = streams.get(callId);
      if (stream === undefined) return; // 这条线一个字都没吐过 → 没有东西可发
      stream.close();
      streams.delete(callId);
    },

    closeAll() {
      // 用户停止 / 轮次出错时走这里：已经跑出来的输出必须看得见，不能压在批次里消失
      for (const [, stream] of streams) stream.close();
      streams.clear();
    },
  };
}
