import type { SessionMeta, StoredMessage } from './session-store';

/**
 * 会话落盘的**记账与排队**（外部审查 T6 的①②）。
 *
 * 为什么单独成一个文件（与 `session-lru.ts` 同一个理由）：这两件事是"顺序与计数"的坑，
 * 混在 `chat-service` 里就**既测不动、变异也咬不到** —— 而 `chat-service` 依赖 electron，
 * 在 vitest 里根本加载不了（复核 033 的 R-4）。抽出来之后这里可以纯测。
 *
 * 两条规矩：
 * 1. **先落消息，立刻记数，再写元信息**（①）。
 *    以前是 `record()` 一步做完：追加成功而 meta 写失败时计数不推进，
 *    于是下一轮把同一批消息**再追加一遍** —— 用户看到的是历史里成对重复的对话。
 *    现在的失败形状是"元信息旧了一格"，而不是"数据多了一份"。
 * 2. **同一个会话的落盘串行**（②）。
 *    两个触发点会撞在一起：一轮结束时的那次 flush、以及同一时刻的内存淘汰。
 *    并发跑就会各自算出同一段"新增"，然后都追加一遍。
 */

export interface JournalWriter {
  append(id: string, messages: StoredMessage[]): Promise<void>;
  saveMeta(meta: SessionMeta): Promise<void>;
}

export interface FlushOutcome {
  /** 本次真正追加了多少条（0 = 没有新增） */
  appended: number;
  /** 落盘后的总条数（= 已记账的条数） */
  total: number;
  /** 元信息 / 清单写失败的说明；null = 没失败。**这不会回退 appended** */
  metaError: string | null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 每个 key 一条 Promise 链。
 *
 * 只做"排队"，不做重试：失败由调用方看到并如实报告（静默重试会把偶发故障变成难查故障）。
 * 链上挂的是"这个 key 上一次跑完没有"，与成功失败无关 —— 否则一次失败就把后面的全堵死。
 */
export function createSerialQueue(): {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** 当前挂着任务（含正在跑的那个）的 key 数 */
  pending(): number;
  forget(key: string): void;
} {
  const tail = new Map<string, Promise<void>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tail.get(key) ?? Promise.resolve();
      const current = previous.then(task);
      // 链尾只保留"结束"这一件事，错误从 current 那一路交给调用方
      tail.set(
        key,
        current.then(
          () => undefined,
          () => undefined,
        ),
      );
      return current;
    },
    pending: () => tail.size,
    forget: (key) => {
      tail.delete(key);
    },
  };
}

export interface SessionJournal {
  /**
   * 把"当前内存里的全部消息"与"已落盘的条数"对一下，追加差集。
   * 调用方**不需要**自己算新增了什么 —— 算错一次就会写出重复历史。
   */
  flush(
    id: string,
    messages: readonly StoredMessage[],
    metaFor: (total: number) => SessionMeta,
  ): Promise<FlushOutcome>;
  /** 会话已从磁盘装载：把记账对齐到盘上已有的条数 */
  restored(id: string, count: number): void;
  /** 会话从内存卸载：丢掉记账与队列，避免无界增长 */
  forget(id: string): void;
  /** 已记账的条数（测试与诊断用） */
  persistedCount(id: string): number;
}

export function createSessionJournal(
  writer: JournalWriter,
  queue = createSerialQueue(),
): SessionJournal {
  const persisted = new Map<string, number>();

  return {
    async flush(id, messages, metaFor): Promise<FlushOutcome> {
      return queue.run(id, async () => {
        const done = persisted.get(id) ?? 0;
        const fresh = messages.slice(done);
        if (fresh.length === 0) return { appended: 0, total: done, metaError: null };
        // ① 消息先落盘；这一步失败就抛给调用方，**计数不推进**（这条路径本来就没写进去）
        await writer.append(id, fresh);
        persisted.set(id, messages.length);
        try {
          await writer.saveMeta(metaFor(messages.length));
          return { appended: fresh.length, total: messages.length, metaError: null };
        } catch (err) {
          // 这里**不回退计数**：消息已经在磁盘上了，回退就等于下一轮重放一遍
          return { appended: fresh.length, total: messages.length, metaError: errText(err) };
        }
      });
    },
    restored: (id, count) => {
      persisted.set(id, count);
    },
    forget: (id) => {
      persisted.delete(id);
      queue.forget(id);
    },
    persistedCount: (id) => persisted.get(id) ?? 0,
  };
}
