/**
 * 长命令的**实时输出合并泵**（R8.7 · M4 收尾其三）。
 *
 * 只做一件事：把子进程按块吐出的数据**攒够一批再交**，且**一段都不丢**。
 *
 * 两条上界各管一头，缺一条都会留下一个看得见的毛病：
 * - **按字节**（`maxChars`）：刷屏型命令的事件数量上限（256KB ÷ 2K ≈ 128 条，是个有限的数）；
 * - **按静默期**（`quietMs`）：`npm run build` 先吐两行、然后安静半分钟 —— 只按字节攒批的话
 *   这两行会一直压在批次里直到命令结束才出现，界面又回到"跑了 30 秒什么都看不见"。
 *   （这一条是本轮自己踩出来的：先写完按字节版本，e2e 里"命令还在跑就先看见 EARLY"当场不成立。）
 *
 * 定时器带来的两个坑各自有对应处理：
 * ① 到点回调与 `flush()` 竞争 → `flushNow` 对空批次直接返回，"结束后又冒出一行"不可能发生；
 * ② 收尾必须撤表 → `flush()` 先撤定时器，且 `tool_end` / 用户停止都走同一个 `close`。
 * 不给 `quietMs` 时退化为纯按字节攒批（纯同步的调用方不必被迫带计时器）。
 */

import { trimTail } from '../terminal/terminal';

export interface OutputPumpOptions {
  /** 攒够多少个字符就推送（也是单个 IPC 事件的字符上限） */
  maxChars: number;
  /** 交出去 —— 调用方负责推 IPC / 记账，这一层不做任何 IO */
  push: (text: string) => void;
  /** 静默多少毫秒就把攒着的批次先交出去；不给 = 只按字节攒批 */
  quietMs?: number | undefined;
  /** 可注入调度器（单测用它代替真计时器；默认 `setTimeout`） */
  schedule?: ((fn: () => void) => unknown) | undefined;
  /** 与 `schedule` 配对的撤销（默认 `clearTimeout`） */
  cancel?: ((handle: unknown) => void) | undefined;
}

export interface OutputPump {
  feed(text: string): void;
  flush(): void;
  /** 当前还压着多少字符（测试与"要不要显示输出中"要用） */
  buffered(): number;
}

export function createOutputPump(options: OutputPumpOptions): OutputPump {
  const cap = Math.max(1, Math.floor(Number.isFinite(options.maxChars) ? options.maxChars : 1));
  const quietMs = options.quietMs;
  const arm =
    quietMs === undefined
      ? undefined
      : (fn: () => void): unknown => options.schedule?.(fn) ?? setTimeout(fn, quietMs);
  const disarm =
    quietMs === undefined ? undefined : (handle: unknown): void => options.cancel?.(handle) ?? clearTimeout(handle as never);

  let buffer = '';
  let timer: unknown = undefined;

  const flushNow = (): void => {
    if (buffer === '') return;
    const batch = buffer;
    buffer = '';
    options.push(batch);
  };
  const clearTimer = (): void => {
    if (timer === undefined || disarm === undefined) return;
    disarm(timer);
    timer = undefined;
  };
  /** 攒满一批就交；没攒够则挂/续一个静默定时器 */
  const sync = (): void => {
    if (arm === undefined) return;
    if (buffer === '') {
      clearTimer();
      return;
    }
    if (timer === undefined) {
      timer = arm(() => {
        timer = undefined;
        flushNow();
      });
    }
  };

  return {
    feed(text: string): void {
      if (text === '') return;
      buffer += text;
      while (buffer.length >= cap) {
        const batch = buffer.slice(0, cap);
        buffer = buffer.slice(cap);
        options.push(batch);
      }
      sync();
    },
    flush(): void {
      // 收尾必须走同一条推送路径：两条路径（正常结束 / 用户停止）差一个字符都会让界面尾巴缺一块
      clearTimer();
      flushNow();
    },
    buffered(): number {
      return buffer.length;
    },
  };
}

export interface ToolOutputStreamOptions {
  /** 界面上保留多少字符的尾部（内存与单条 IPC 事件的上界） */
  maxTailChars: number;
  /** 攒够多少个字符发一份快照（发端频率的字节上界） */
  flushChars: number;
  /** 静默多久先发一份（频率的时间上界）；不给 = 只按字节 */
  quietMs?: number | undefined;
  /** 交出一份"截至此刻的尾部快照" */
  pushTail: (tail: string) => void;
}

export interface ToolOutputStream {
  feed(chunk: string): void;
  close(): void;
  /** 当前尾部（测试与"要不要显示实时输出"那一格要用） */
  tail(): string;
}

/**
 * 一次工具调用的实时输出流：把 `createOutputPump`（攒批）与"尾部快照"合在一处。
 *
 * 为什么快照而不是增量：界面收到什么就整段替换什么，于是
 * ① 切走页签期间错过的块不会真丢（回来仍能看到最新那一份），
 * ② 不需要终端那套 `seq` 去重 —— 少一个机制就少一种错法。
 * 尾部上限复用终端那份 `trimTail`（**同一件事只有一处定义**，不另写一份切片逻辑）。
 */
export function createToolOutputStream(options: ToolOutputStreamOptions): ToolOutputStream {
  let tail = '';
  const pump = createOutputPump({
    maxChars: options.flushChars,
    ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
    push: (batch) => {
      tail = trimTail(tail, batch, options.maxTailChars);
      options.pushTail(tail);
    },
  });
  return {
    feed(chunk: string): void {
      pump.feed(chunk);
    },
    close(): void {
      pump.flush();
    },
    tail(): string {
      return tail;
    },
  };
}
