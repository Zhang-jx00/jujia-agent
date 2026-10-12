import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEDULE_JITTER_WINDOW_MS, SCHEDULE_PROMPT_MAX_CHARS, type ScheduledTask } from '@jujia/shared-ipc';
import { createFileScheduleStore, createMemoryScheduleStore, type ScheduleStore } from './schedule-store';

/**
 * 定时任务这本账（M7 · R9）。
 *
 * 内存孪生与文件版**共用同一套校验**（`validateTaskInput` 只有一处），
 * 所以这里的用例对两者都成立 —— 下面把两种实现各跑一遍，
 * 防的是"文件版多一条规则、内存版没有"（跨层测试不能替模块自己的测试代言，反过来也一样）。
 */

/** 清单应当恰好一条：拿不到就当场说清楚，别把 `undefined` 递进断言 */
async function one(store: ScheduleStore): Promise<ScheduledTask> {
  const [first] = await store.list();
  if (first === undefined) throw new Error('账上应当恰好有一条任务');
  return first;
}

const good = () => ({
  name: '每天早报',
  rule: 'FREQ=DAILY;BYHOUR=9',
  prompt: '把昨天的待办汇总一下',
  connectionId: 'conn-1',
});

const make = (over: Record<string, unknown> = {}) => ({ ...good(), ...over });

describe('保存：该收的收、该拒的拒', () => {
  it('新建给回 id、锚点、抖动，且抖动落在窗口内', async () => {
    const store = createMemoryScheduleStore();
    const res = await store.upsert(make());
    if (!res.ok) throw new Error(res.error);
    expect(res.task.id).toMatch(/^[a-z0-9-]{6,64}$/);
    expect(Number.isNaN(new Date(res.task.anchorAt).getTime())).toBe(false);
    expect(res.task.jitterMs).toBeGreaterThanOrEqual(0);
    expect(res.task.jitterMs).toBeLessThan(SCHEDULE_JITTER_WINDOW_MS);
    expect(res.task.enabled).toBe(true);
    expect(res.task.lastRunAt).toBe(null);
  });

  it('同一个 id 再存一次是改，不是又多出一条', async () => {
    const store = createMemoryScheduleStore();
    const created = await store.upsert(make());
    if (!created.ok) throw new Error(created.error);
    const edited = await store.upsert(make({ id: created.task.id, name: '改成 09:30' }));
    if (!edited.ok) throw new Error(edited.error);
    expect(await store.list()).toHaveLength(1);
    // 锚点不跟着改规则走：改了时刻也不该把"今天已经过掉的那一次"变成欠账
    expect(edited.task.anchorAt).toBe(created.task.anchorAt);
    expect(edited.task.jitterMs).toBe(created.task.jitterMs);
  });

  it('规则坏了 → 拒收，错误里带着解析的原文（不许"存下来但永远不触发"）', async () => {
    const store = createMemoryScheduleStore();
    const res = await store.upsert(make({ rule: 'FREQ=MONTHLY' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('MONTHLY');
    expect(await store.list()).toHaveLength(0);
  });

  it('空规则 / 空提示词 / 空名字 / 空连接都拒收', async () => {
    const store = createMemoryScheduleStore();
    for (const over of [{ rule: '  ' }, { prompt: '' }, { name: '  ' }, { connectionId: '' }]) {
      const res = await store.upsert(make(over));
      expect(res.ok, JSON.stringify(over)).toBe(false);
    }
  });

  it('提示词超长拒收并写明上限（不截断 —— 截断等于偷偷改用户要跑的东西）', async () => {
    const store = createMemoryScheduleStore();
    const res = await store.upsert(make({ prompt: 'x'.repeat(SCHEDULE_PROMPT_MAX_CHARS + 1) }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(SCHEDULE_PROMPT_MAX_CHARS));
  });

  it('带"免审批"这种字段直接拒收 —— 定时不等于免审批，账本上就不许有这一格', async () => {
    const store = createMemoryScheduleStore();
    for (const key of ['autoApprove', 'alwaysAllow', 'skipPermission']) {
      const res = await store.upsert(make({ [key]: true }));
      expect(res.ok, key).toBe(false);
      if (!res.ok) expect(res.error).toContain(key);
    }
  });

  it('改别人正在用的 id 不会静默新建（id 形状不对就拒）', async () => {
    const store = createMemoryScheduleStore();
    const res = await store.upsert(make({ id: '../../etc/passwd' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('标识');
  });
});

describe('上限：清单不该无限增长', () => {
  it('第 51 条拒收并说明上限', async () => {
    const store = createMemoryScheduleStore();
    for (let i = 0; i < 50; i += 1) {
      const res = await store.upsert(make({ name: `任务 ${String(i)}` }));
      if (!res.ok) throw new Error(`第 ${String(i)} 条不该被拒：${res.error}`);
    }
    const overflow = await store.upsert(make({ name: '第 51 条' }));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error).toContain('50');
  });

  it('满员之后"改一条"仍然改得动（上限卡的是新增，不是编辑）', async () => {
    const store = createMemoryScheduleStore();
    let firstId = '';
    for (let i = 0; i < 50; i += 1) {
      const res = await store.upsert(make({ name: `任务 ${String(i)}` }));
      if (!res.ok) throw new Error(res.error);
      if (i === 0) firstId = res.task.id;
    }
    const edited = await store.upsert(make({ id: firstId, name: '改过的名字' }));
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.task.name).toBe('改过的名字');
    expect(await store.list()).toHaveLength(50);
  });
});

describe('触发记账（水位线）', () => {
  it('markRun 只动它该动的字段，其它原样保留', async () => {
    const store = createMemoryScheduleStore();
    const created = await store.upsert(make());
    if (!created.ok) throw new Error(created.error);
    const res = await store.markRun(created.task.id, {
      at: '2026-10-12T01:00:00.000Z',
      skipped: 2,
      sessionId: 'sess-abc123',
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.task.lastRunAt).toBe('2026-10-12T01:00:00.000Z');
    expect(res.task.lastSkipped).toBe(2);
    expect(res.task.sessionId).toBe('sess-abc123');
    expect(res.task.name).toBe('每天早报');
    expect(res.task.rule).toBe('FREQ=DAILY;BYHOUR=9');
  });

  it('失败也要落账（error 有值），否则"到点没跑"和"跑了但坏了"在界面上长得一样', async () => {
    const store = createMemoryScheduleStore();
    const created = await store.upsert(make());
    if (!created.ok) throw new Error(created.error);
    await store.markRun(created.task.id, {
      at: '2026-10-12T01:00:00.000Z',
      skipped: 0,
      error: '连接已被删除，这次没有执行任何东西',
    });
    const task = await one(store);
    expect(task.lastError).toContain('连接已被删除');
  });

  it('并发 20 次记账一条都不能丢（读—改—写必须在临界区里）', async () => {
    const store = createMemoryScheduleStore();
    const created = await store.upsert(make());
    if (!created.ok) throw new Error(created.error);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.markRun(created.task.id, {
          at: new Date(2026, 9, 12, 9, i).toISOString(),
          skipped: i,
        }),
      ),
    );
    const task = await one(store);
    // 最后一次是 i=19；中间任何一次被"读—改—写"覆盖掉都会让它变回更早的值或弄丢 sessionId
    expect(task.lastSkipped).toBe(19);
    expect(task.lastRunAt).toBe(new Date(2026, 9, 12, 9, 19).toISOString());
  });

  it('给不存在的 id 记账 → 明确失败，不是静默什么都不做', async () => {
    const store = createMemoryScheduleStore();
    const res = await store.markRun('nonexistent-id', { at: '2026-10-12T01:00:00.000Z', skipped: 0 });
    expect(res.ok).toBe(false);
  });
});

describe('停用与删除', () => {
  it('停用不删账（上次跑过几次还得看得见），启用回到同一份', async () => {
    const store = createMemoryScheduleStore();
    const created = await store.upsert(make());
    if (!created.ok) throw new Error(created.error);
    await store.markRun(created.task.id, { at: '2026-10-12T01:00:00.000Z', skipped: 0 });
    await store.setEnabled(created.task.id, false);
    const stopped = await store.get(created.task.id);
    expect(stopped?.enabled).toBe(false);
    expect(stopped?.lastRunAt).not.toBe(null);
    await store.setEnabled(created.task.id, true);
    expect((await store.get(created.task.id))?.enabled).toBe(true);
  });

  it('删除后不再出现在清单里', async () => {
    const store = createMemoryScheduleStore();
    const created = await store.upsert(make());
    if (!created.ok) throw new Error(created.error);
    await store.remove(created.task.id);
    expect(await store.list()).toHaveLength(0);
  });
});

describe('校验只有一处：内存版与文件版必须给同一个答案', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['坏规则', { rule: 'FREQ=YEARLY' }],
    ['免审批字段', { autoApprove: true }],
    ['空提示词', { prompt: '   ' }],
    ['脏 id', { id: 'no_good' }],
    ['超长提示词', { prompt: 'x'.repeat(SCHEDULE_PROMPT_MAX_CHARS + 5) }],
  ];

  for (const [label, over] of cases) {
    it(`「${label}」在两个实现里被同一句话拒绝`, async () => {
      const dir = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-schedule-'));
      try {
        const memory = createMemoryScheduleStore();
        const file = createFileScheduleStore(dir);
        const a = await memory.upsert(make(over));
        const b = await file.upsert(make(over));
        expect(a.ok).toBe(false);
        expect(b.ok).toBe(false);
        if (a.ok || b.ok) throw new Error('两个实现都应当拒绝');
        // 逐字相同：不同就是"两处各说各话"，界面显示的理由会随走哪条路而变
        expect(b.error).toBe(a.error);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});
