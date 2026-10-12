import { describe, expect, it } from 'vitest';
import { createMemoryScheduleStore, type ScheduleStore } from './schedule-store';
import { createScheduleService, type ScheduleEvent, type ScheduleService } from './schedule-service';
import type { ScheduledTask } from '@jujia/shared-ipc';

/**
 * 定时任务的发动机（M7 · R9）。
 *
 * 这一层只做三件事：**问纯算式该不该跑 → 起一轮对话 → 把结果落账**。
 * 起对话用的是 `startTurn`（与用户敲字同一个函数），所以到点这一路
 * 照样过同一扇权限门 —— 本文件里有一条用例专门钉住"这里不许出现第二套触发路径"。
 */

const ISO = (y: number, mo: number, d: number, h = 0, mi = 0): string =>
  new Date(y, mo - 1, d, h, mi, 0, 0).toISOString();

interface Call {
  connectionId: string;
  text: string;
  sessionId?: string;
}

interface Harness {
  store: ScheduleStore;
  service: ScheduleService;
  calls: Call[];
  events: ScheduleEvent[];
  concurrent: number;
  maxConcurrent: number;
  failNext: Error | null;
  busy: Set<string>;
}

function harness(
  initial: ScheduledTask[],
  opts: { now?: () => Date; isBusy?: (sessionId: string) => boolean } = {},
): Harness {
  const store = createMemoryScheduleStore(initial);
  const h: Harness = {
    store,
    service: undefined as unknown as ScheduleService,
    calls: [],
    events: [],
    concurrent: 0,
    maxConcurrent: 0,
    failNext: null,
    busy: new Set(),
  };
  h.service = createScheduleService({
    store,
    now: opts.now ?? (() => new Date(2026, 9, 12, 9, 30)),
    events: (e) => h.events.push(e),
    isBusy: (sessionId) => h.busy.has(sessionId) || opts.isBusy?.(sessionId) === true,
    startTurn: async (input) => {
      h.concurrent += 1;
      h.maxConcurrent = Math.max(h.maxConcurrent, h.concurrent);
      h.calls.push(input);
      if (h.failNext !== null) {
        const err = h.failNext;
        h.failNext = null;
        h.concurrent -= 1;
        throw err;
      }
      // 让"并发"真的能被观察到：不 await 这段就永远是 1
      await Promise.resolve();
      h.concurrent -= 1;
      return { sessionId: `sess-of-${input.connectionId}`, messageId: 'msg-1', warning: null };
    },
  });
  return h;
}

/** 清单应当恰好一条：拿不到就当场说清楚，别把 `undefined` 递进断言（那失败信息没人读得懂） */
async function one(store: ScheduleStore): Promise<ScheduledTask> {
  const [first] = await store.list();
  if (first === undefined) throw new Error('账上应当恰好有一条任务');
  return first;
}

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-aaaaaa',
  name: '每天早报',
  rule: 'FREQ=DAILY;BYHOUR=9',
  prompt: '汇总昨天的待办',
  connectionId: 'conn-1',
  anchorAt: ISO(2026, 10, 1),
  sessionId: null,
  enabled: true,
  jitterMs: 0,
  lastRunAt: null,
  lastSkipped: 0,
  lastError: '',
  ...over,
});

describe('到点就起一轮，没到点一次都不起', () => {
  it('时刻到了 → 起一轮，参数就是任务里存的那三样', async () => {
    const h = harness([task()]);
    await h.service.tickOnce();
    expect(h.calls).toEqual([{ connectionId: 'conn-1', text: '汇总昨天的待办', sessionId: undefined }]);
  });

  it('时刻没到 → 一次都不起', async () => {
    // 昨天 09:00 那次已经跑过（水位线在那儿），今天 09:00 还没到 → 本 tick 什么都不做。
    // 注意不能用"从没跑过 + 锚点十几天前"来测这条：那种状态是积压，本来就该起一轮补跑。
    const h = harness([task({ lastRunAt: ISO(2026, 10, 11, 9, 30) })], {
      now: () => new Date(2026, 9, 12, 8, 30),
    });
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(0);
  });

  it('停用的任务即使早就过期也不起', async () => {
    const h = harness([task({ enabled: false })]);
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(0);
    const t = await one(h.store);
    expect(t.lastRunAt).toBe(null);
  });

  it('已经有会话就续到那个会话（不每次新建、把会话列表灌满）', async () => {
    const h = harness([task({ sessionId: 'sess-old-1', lastRunAt: ISO(2026, 10, 11, 9, 30) })]);
    await h.service.tickOnce();
    expect(h.calls[0]?.sessionId).toBe('sess-old-1');
  });
});

describe('落账的水位线', () => {
  it('补跑之后：跑的是最近那一次，欠的次数照实记，下一次排明天', async () => {
    const h = harness([task({ lastRunAt: ISO(2026, 10, 9, 12) })], {
      now: () => new Date(2026, 9, 12, 15),
    });
    await h.service.tickOnce();
    const t = await one(h.store);
    // 水位线写成"被补的那一次 10-12 09:00"，不是此刻 15:00 —— 写成此刻就把这一笔静默吃掉了
    expect(t.lastRunAt).toBe(ISO(2026, 10, 12, 9));
    expect(t.lastSkipped).toBe(2);
    expect(t.lastError).toBe('');
  });

  it('第一次触发把新建的会话 id 记回任务上', async () => {
    const h = harness([task()]);
    await h.service.tickOnce();
    const t = await one(h.store);
    expect(t.sessionId).toBe('sess-of-conn-1');
  });

  it('同一个 tick 连跑两次不会把同一次补跑跑两遍', async () => {
    const h = harness([task({ lastRunAt: ISO(2026, 10, 9, 12) })], {
      now: () => new Date(2026, 9, 12, 15),
    });
    await h.service.tickOnce();
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(1);
  });

  it('起一轮失败：推进水位线 + 把原因落在账上，且不原地重试', async () => {
    const h = harness([task()]);
    h.failNext = new Error('连接已被删除');
    await h.service.tickOnce();
    const t = await one(h.store);
    expect(t.lastError).toContain('连接已被删除');
    expect(t.lastRunAt).toBe(ISO(2026, 10, 12, 9));
    // 同一次不再重试（下一次要等下一个到点）
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(1);
  });

  it('失败也要有一条事件（面板不打开也该看得见出过事）', async () => {
    const h = harness([task()]);
    h.failNext = new Error('上游 500');
    await h.service.tickOnce();
    expect(h.events.map((e) => e.kind)).toEqual(['failed']);
    expect(h.events[0]?.note).toContain('上游 500');
  });
});

describe('一次只跑一条（不并发、不抢占）', () => {
  it('两条同时到点 → 串行，绝不并发', async () => {
    const h = harness([
      task({ id: 'task-aaaaaa', name: '甲', lastRunAt: ISO(2026, 10, 11, 9, 30) }),
      task({ id: 'task-bbbbbb', name: '乙', lastRunAt: ISO(2026, 10, 11, 9, 30) }),
    ]);
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(2);
    expect(h.maxConcurrent).toBe(1);
  });

  it('上一轮还没结束 → 本 tick 不起新的，也不推进水位线', async () => {
    const store = createMemoryScheduleStore([task()]);
    const calls: Call[] = [];
    let release: (() => void) | null = null;
    const service = createScheduleService({
      store,
      now: () => new Date(2026, 9, 12, 9, 30),
      events: () => {},
      isBusy: () => false,
      startTurn: async (input) => {
        calls.push(input);
        // 真的挂住：不这么写就无法证明"第二条会排队而不是并发"
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { sessionId: 's', messageId: 'm', warning: null };
      },
    });
    const first = service.tickOnce();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    await service.tickOnce();
    expect(calls).toHaveLength(1);
    const during = await store.list();
    expect(during[0]?.lastRunAt).toBe(null);
    (release as unknown as () => void)();
    await first;
    const after = await store.list();
    expect(after[0]?.lastRunAt).toBe(ISO(2026, 10, 12, 9));
  });

  it('那条任务绑定的会话正在被用户用 → 不起、不动账（不是失败，是还没轮到）', async () => {
    const h = harness([task({ sessionId: 'sess-busy', lastRunAt: ISO(2026, 10, 11, 9, 30) })]);
    h.busy.add('sess-busy');
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(0);
    const t = await one(h.store);
    expect(t.lastRunAt).toBe(ISO(2026, 10, 11, 9, 30));
    expect(t.lastError).toBe('');
  });
});

describe('规则坏了必须说出来，但不许动水位线', () => {
  it('坏规则 → 不起、不推进，报一次 invalid-rule 事件', async () => {
    const h = harness([task({ rule: 'FREQ=DAILY;COUNT=5' })]);
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(0);
    const t = await one(h.store);
    expect(t.lastRunAt).toBe(null);
    expect(h.events.map((e) => e.kind)).toEqual(['invalid-rule']);
    expect(h.events[0]?.note).toContain('COUNT');
  });

  it('同一条坏规则不每个 tick 重复报（只报第一次），改好之后恢复正常', async () => {
    const h = harness([task({ rule: 'FREQ=MONTHLY' })]);
    await h.service.tickOnce();
    await h.service.tickOnce();
    expect(h.events).toHaveLength(1);
    await h.store.upsert({ id: 'task-aaaaaa', name: '每天早报', rule: 'FREQ=DAILY;BYHOUR=9', prompt: '汇总', connectionId: 'conn-1' });
    await h.service.tickOnce();
    expect(h.calls).toHaveLength(1);
  });
});

describe('定时器：start / stop 都要真的生效', () => {
  it('stop() 之后 tick 不再发生', async () => {
    let fire: (() => void) | null = null;
    const store = createMemoryScheduleStore([task()]);
    const calls: Call[] = [];
    const service = createScheduleService({
      store,
      now: () => new Date(2026, 9, 12, 9, 30),
      events: () => {},
      isBusy: () => false,
      startTurn: async (input) => {
        calls.push(input);
        return { sessionId: 's', messageId: 'm', warning: null };
      },
      // 假调度器：只有 stop 真的撤了句柄，才不会有后续触发
      schedule: (fn) => {
        fire = fn;
        return 'handle-1';
      },
      cancel: (handle) => {
        if (handle === 'handle-1') fire = null;
      },
      tickMs: 1000,
    });
    service.start();
    expect(typeof fire).toBe('function');
    // 启动时立刻看一眼（开机补跑不该等一个完整 tick）—— 这一眼是异步的，要等它落定
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    calls.length = 0;
    service.stop();
    expect(fire).toBe(null);
    await service.tickOnce();
    expect(calls).toHaveLength(0);
  });

  it('成功的触发也有一条事件（面板看得见"跑过了"，而不是只有失败才说话）', async () => {
    const h = harness([task({ lastRunAt: ISO(2026, 10, 9, 12) })], {
      now: () => new Date(2026, 9, 12, 15),
    });
    await h.service.tickOnce();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.kind).toBe('fired');
    expect(h.events[0]?.name).toBe('每天早报');
    expect(h.events[0]?.note).toContain('跳过 2 次');
  });
});
