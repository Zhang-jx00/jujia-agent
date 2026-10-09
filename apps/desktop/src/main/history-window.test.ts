import { describe, expect, it } from 'vitest';
import { historyWindow, pickHistoryPage } from './history-window';

/**
 * 历史分页的**唯一口径**（外部审查 T33）。
 *
 * 为什么单独立一个纯模块：`chat-service` 依赖 electron，vitest 里加载不了（6a 的
 * `session-journal.ts` 就是因为这个才被抽出去）—— 而 T33 这条 bug 恰恰是"两份判断各说各话"，
 * 用读源码的接线锁是盯不住的（锁只能证明"这行代码在场"，不能证明"两条路给同一个答案"）。
 */

type Msg = { role: string; content: string };

const msg = (role: string, i: number): Msg => ({ role, content: `${role}#${String(i)}` });

/** 磁盘上的历史：system 那条不落盘，所以数组里没有它 */
const disk = (n: number): Msg[] =>
  Array.from({ length: n }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', i));

/** 驻留内存的会话：index 0 是重新装配的 system，其余与磁盘同序 */
const resident = (n: number): Msg[] => [{ role: 'system', content: 'BASE' }, ...disk(n)];

describe('历史分页的唯一口径', () => {
  it('同一个会话的两条取史路（驻留含 system / 磁盘不含）给出逐字相同的页', () => {
    for (const limit of [1, 7, 20, 120]) {
      expect(pickHistoryPage(resident(20), { limit })).toEqual(pickHistoryPage(disk(20), { limit }));
    }
  });

  it('盘上整页数时不许把 system 算成"还有一条"（那就是按钮点了没反应的形状）', () => {
    const page = pickHistoryPage(resident(120), { limit: 120 });
    expect(page.hasMore).toBe(0);
    expect(page.total).toBe(120);
  });

  it('续聊记下before、随后 hydrate 前插 system —— 往前翻不能跳过任何一条', () => {
    const first = pickHistoryPage(disk(30), { limit: 10 }); // 续聊那一页走的是磁盘口径
    const second = pickHistoryPage(resident(30), { limit: 10, before: first.hasMore }); // 发过消息之后走驻留口径
    expect(second.messages.map((m) => m.content)).toEqual(disk(30).slice(10, 20).map((m) => m.content));
  });

  it('只剥**开头**那条 system；历史中间出现的 system 不许一起剥掉', () => {
    const withMiddle: Msg[] = [msg('user', 0), { role: 'system', content: '中途的系统消息' }, msg('assistant', 1)];
    expect(historyWindow(withMiddle)).toHaveLength(3);
    expect(historyWindow(resident(3))).toHaveLength(3);
    expect(historyWindow([])).toHaveLength(0);
  });

  it('limit 仍然夹在 1–400（既有行为不许漂）', () => {
    expect(pickHistoryPage(disk(500), { limit: 0 }).messages).toHaveLength(1);
    expect(pickHistoryPage(disk(500), { limit: 5_000 }).messages).toHaveLength(400);
    expect(pickHistoryPage(disk(500), {}).messages).toHaveLength(120);
  });
});
