import { describe, expect, it } from 'vitest';
import {
  createSerialQueue,
  createSessionJournal,
  type FlushOutcome,
} from './session-journal';
import type { SessionMeta, StoredMessage } from './session-store';

/**
 * 会话落盘的记账与排队（外部审查 T6 的①②）。
 *
 * 这一层是"顺序与计数"的坑，不是"字节"的坑 —— 所以用假 writer 打得开：
 * 真实磁盘行为归 `session-store.test.ts`，这里只管"谁先谁后、记了几条、失败算不算写过的"。
 */

const msg = (content: string): StoredMessage => ({
  v: 1,
  t: '2026-09-27T00:00:00.000Z',
  role: 'user',
  content,
});

const metaOf = (id: string, messageCount: number): SessionMeta => ({
  id,
  connectionId: 'c1',
  title: 't',
  createdAt: '2026-09-27T00:00:00.000Z',
  lastUsedAt: '2026-09-27T00:00:00.000Z',
  messageCount,
  compactedThrough: 0,
});

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000000';

describe('createSerialQueue', () => {
  it('同一个 key 的任务严格按顺序跑（前一个没完，后一个不许进）', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    const first = queue.run('a', async () => {
      await new Promise<void>((r) => setTimeout(r, 30));
      log.push('first-end');
    });
    const second = queue.run('a', async () => {
      log.push('second-start');
    });
    await Promise.all([first, second]);
    expect(log).toEqual(['first-end', 'second-start']);
  });

  it('不同 key 互不排队（否则会人为把并发会话串成一条）', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    await Promise.all([
      queue.run('a', async () => {
        await new Promise<void>((r) => setTimeout(r, 25));
        log.push('a');
      }),
      queue.run('b', async () => {
        log.push('b');
      }),
    ]);
    expect(log[0]).toBe('b');
  });

  it('一次失败不堵死后面的任务（失败要说得清，但队列不能因此冻住）', async () => {
    const queue = createSerialQueue();
    await expect(queue.run('a', async () => {
      throw new Error('写盘失败');
    })).rejects.toThrow('写盘失败');
    await expect(queue.run('a', async () => 7)).resolves.toBe(7);
  });
});

describe('落盘记账（T6①）', () => {
  it('消息落盘后元信息写失败：计数**不回退**，下一轮不会重放同一批', async () => {
    const appended: StoredMessage[][] = [];
    const journal = createSessionJournal(
      {
        append: async (_id, messages) => {
          appended.push(messages);
        },
        saveMeta: async () => {
          throw new Error('元信息写不进去');
        },
      },
    );

    const first = await journal.flush(SESSION_ID, [msg('一'), msg('二')], (n) => metaOf(SESSION_ID, n));
    expect(first).toEqual<FlushOutcome>({ appended: 2, total: 2, metaError: '元信息写不进去' });
    expect(journal.persistedCount(SESSION_ID)).toBe(2);

    // 第二flush：只剩新来的一条 —— 这就是"不重放"的字面意思
    const second = await journal.flush(
      SESSION_ID,
      [msg('一'), msg('二'), msg('三')],
      (n) => metaOf(SESSION_ID, n),
    );
    expect(second.appended).toBe(1);
    expect(appended[1]?.map((m) => m.content)).toEqual(['三']);
  });

  it('消息本身没写进去：不记账，下一轮会带着同一批重试（这才是"不能假装写过"）', async () => {
    let attempts = 0;
    const journal = createSessionJournal({
      append: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('磁盘满了');
      },
      saveMeta: async () => undefined,
    });

    await expect(journal.flush(SESSION_ID, [msg('一')], (n) => metaOf(SESSION_ID, n))).rejects.toThrow('磁盘满了');
    expect(journal.persistedCount(SESSION_ID)).toBe(0);

    const retry = await journal.flush(SESSION_ID, [msg('一')], (n) => metaOf(SESSION_ID, n));
    expect(retry.appended).toBe(1);
    expect(journal.persistedCount(SESSION_ID)).toBe(1);
  });

  it('没有新增时一条 IO 都不做（空 flush 不该造出文件）', async () => {
    let appends = 0;
    let metas = 0;
    const journal = createSessionJournal({
      append: async () => {
        appends += 1;
      },
      saveMeta: async () => {
        metas += 1;
      },
    });
    journal.restored(SESSION_ID, 3);
    const out = await journal.flush(SESSION_ID, [msg('a'), msg('b'), msg('c')], (n) => metaOf(SESSION_ID, n));
    expect(out).toEqual<FlushOutcome>({ appended: 0, total: 3, metaError: null });
    expect(appends).toBe(0);
    expect(metas).toBe(0);
  });
});

describe('同一会话的并发落盘（T6②）', () => {
  it('轮次结束的 flush 与淘汰时的 flush 撞在一起：只追加一次', async () => {
    const appended: string[][] = [];
    const journal = createSessionJournal({
      append: async (_id, messages) => {
        await new Promise<void>((r) => setTimeout(r, 10)); // 真 IO 有耗时，才测得出交错
        appended.push(messages.map((m) => m.content));
      },
      saveMeta: async () => undefined,
    });
    const all = [msg('一'), msg('二')];
    const [a, b] = await Promise.all([
      journal.flush(SESSION_ID, all, (n) => metaOf(SESSION_ID, n)),
      journal.flush(SESSION_ID, all, (n) => metaOf(SESSION_ID, n)),
    ]);
    expect(a.appended).toBe(2);
    expect(b.appended).toBe(0); // 第二次进来时已经记过账了
    expect(appended).toEqual([['一', '二']]);
  });

  it('forget 之后账目与队列一起清掉（会话从内存卸载不该留残迹）', async () => {
    const journal = createSessionJournal({
      append: async () => undefined,
      saveMeta: async () => undefined,
    });
    await journal.flush(SESSION_ID, [msg('一')], (n) => metaOf(SESSION_ID, n));
    expect(journal.persistedCount(SESSION_ID)).toBe(1);
    journal.forget(SESSION_ID);
    expect(journal.persistedCount(SESSION_ID)).toBe(0);
    // 重新装载（磁盘上已有 1 条）之后按新账继续
    journal.restored(SESSION_ID, 1);
    const out = await journal.flush(SESSION_ID, [msg('一'), msg('二')], (n) => metaOf(SESSION_ID, n));
    expect(out.appended).toBe(1);
  });
});
