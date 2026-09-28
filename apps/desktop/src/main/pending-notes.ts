import { JsonStore } from '@jujia/shared';

/**
 * "哪些会话结束了还没记要点"这本账（铺设计划 6b · 报备 §四，批复④批准）。
 *
 * 为什么不当场写进 NOTES.md：① 退出路径上做模型调用不可靠（进程要退了，异步调用会被杀）；
 * ② "落盘前必须预览"是硬要求，而退出时没人在看屏幕。所以退出只记一笔待办，
 * **下次启动再问一次** —— 写进长期记忆这一步永远发生在人点过之后（双确认，B 的风险等级配得上）。
 *
 * 写盘串行化：`JsonStore.update()` 明写"调用方自行保证不并发改同一份"，
 * 而这里全是"读—改—写"（标记、划掉、改永不问）。6a 的 T6③ 已经栽过一次
 * —— 只串行化写不够，**读也要在临界区里**，所以整条链挂在一条 Promise 上。
 */

export interface PendingNote {
  sessionId: string;
  title: string;
  markedAt: string;
}

interface PendingFile {
  items: PendingNote[];
  neverAsk: boolean;
}

/** 账本只留最近这么多条：追问清单不该无限增长 */
const PENDING_MAX = 20;

/**
 * 退出时要不要再给这个会话记一笔待办。
 *
 * 判据是**落盘条数**（与压缩水印同一个坐标系）：`notedThrough` = 上次处理这条账时它已有几条，
 * `-1` 表示从没处理过。只有"记过之后又多出来的消息"才值得再问一遍 ——
 * 否则用户前脚点完「记」，退出时同一批话又被记上一笔，下次启动再问一次（设计 e2e 时发现的真缺陷）。
 * 宁可少问一次，也不能把没问过的当成问过了。
 */
export function shouldAskAgain(notedThrough: number, persistedCount: number): boolean {
  return persistedCount > 0 && persistedCount > notedThrough;
}

export interface PendingNotes {
  list(): Promise<PendingNote[]>;
  /** 记下"这个会话结束了还没记要点"；同一会话重复标记只更新那一条（幂等） */
  mark(sessionId: string, title: string, now?: Date): Promise<void>;
  /** 记过了 / 决定不记了：从账上划掉（不存在也当成功） */
  clear(sessionId: string): Promise<void>;
  neverAsk(): Promise<boolean>;
  setNeverAsk(value: boolean): Promise<void>;
}

export function createPendingNotes(file: string): PendingNotes {
  const store = new JsonStore<PendingFile>(file, {
    version: 1,
    defaults: () => ({ items: [], neverAsk: false }),
    validate: (input) => {
      const obj = input as Partial<PendingFile>;
      const items = Array.isArray(obj.items)
        ? obj.items.filter(
            (i): i is PendingNote =>
              !!i && typeof i.sessionId === 'string' && typeof i.title === 'string',
          )
        : [];
      return { items: items.slice(-PENDING_MAX), neverAsk: obj.neverAsk === true };
    },
  });

  let chain: Promise<void> = Promise.resolve();
  const onChain = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const mutate = (fn: (current: PendingFile) => PendingFile): Promise<void> =>
    onChain(async () => {
      await store.update(fn);
    });

  return {
    list: () => onChain(async () => (await store.read()).data.items),
    neverAsk: () => onChain(async () => (await store.read()).data.neverAsk),

    mark: (sessionId, title, now = new Date()) =>
      mutate((current) => ({
        ...current,
        items: [...current.items.filter((i) => i.sessionId !== sessionId), {
          sessionId,
          title,
          markedAt: now.toISOString(),
        }].slice(-PENDING_MAX),
      })),

    clear: (sessionId) =>
      mutate((current) => ({ ...current, items: current.items.filter((i) => i.sessionId !== sessionId) })),

    setNeverAsk: (value) => mutate((current) => ({ ...current, neverAsk: value })),
  };
}
