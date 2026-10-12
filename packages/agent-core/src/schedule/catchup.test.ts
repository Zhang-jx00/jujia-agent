import { describe, expect, it } from 'vitest';
import { decideFire, describeSkipped } from './catchup';

/**
 * 补跑口径（M7 · R9）。**至多补一次，但跳过了几次要说出来。**
 *
 * 为什么不当场把错过的每一次都跑一遍：一条"每天 09:00 提醒我看板"的任务
 * 关机一周后开机，连跑七次同样的提醒不是"补上了"，是骚扰；
 * 而一句都不说，用户分不清"到点没到"与"到点了但没跑"。
 * 所以：跑最近的那一次，并把"之前跳过了 N 次"作为可见的一句话交出去。
 *
 * 时间坐标只有两个：`anchorAt`（这条任务最早可能触发的那一刻）与 `lastRunAt`（上一次真触发）。
 * **`lastRunAt` 同时就是补跑的水位线** —— 补跑完写它，同一批积压不会在下一个 tick 又补一遍
 * （铺设计划 6b 的 `shouldAskAgain` 是同族教训：把"已经处理过的"当成"没处理过"会重复问）。
 *
 * 刻意**不报"补的是哪一次"**：那需要一个"上一次发生"的反向算式，而记账只需要
 * "什么时候跑的 + 跳过几次 + 下一次是几点"，为一个好看的字段多一套算式 = 多一种错法。
 */

const ISO = (y: number, mo: number, d: number, h = 0, mi = 0): string =>
  new Date(y, mo - 1, d, h, mi, 0, 0).toISOString();

type Input = Parameters<typeof decideFire>[0];
const task = (over: Partial<Input> = {}): Input => ({
  ruleText: 'FREQ=DAILY;BYHOUR=9',
  anchorAt: ISO(2026, 10, 1),
  lastRunAt: null,
  jitterMs: 0,
  ...over,
});

const asFire = (d: ReturnType<typeof decideFire>) => {
  if (d.kind !== 'fire') throw new Error(`应当判成要跑，实际是 ${d.kind}`);
  return d;
};

describe('到点判定：该跑就跑，不该跑就等着', () => {
  it('时刻没到 → 不跑，并给出下一次是几点', () => {
    const d = decideFire(
      { ...task(), lastRunAt: ISO(2026, 10, 11, 9, 30) },
      new Date(2026, 9, 12, 8, 30),
    );
    expect(d.kind).toBe('none');
    if (d.kind === 'none') expect(d.nextDueAt).toBe(ISO(2026, 10, 12, 9));
  });

  it('时刻到了 → 跑一次，跳过次数是 0（这是正常到点，不是补跑）', () => {
    const d = asFire(
      decideFire({ ...task(), lastRunAt: ISO(2026, 10, 11, 9, 30) }, new Date(2026, 9, 12, 9, 30)),
    );
    expect(d.skippedBefore).toBe(0);
    expect(d.nextDueAt).toBe(ISO(2026, 10, 13, 9));
  });

  it('跑过的那一次不许再跑（水位线就是 lastRunAt）', () => {
    const d = decideFire({ ...task(), lastRunAt: ISO(2026, 10, 12, 9, 5) }, new Date(2026, 9, 12, 9, 30));
    expect(d.kind).toBe('none');
  });

  it('建好却一直没跑过的任务（例：先停用后启用）→ 现在就该跑，欠的次数照实报', () => {
    const d = asFire(decideFire(task(), new Date(2026, 9, 12, 8, 30)));
    // 锚点 10-01 起每天 09:00，到 10-12 08:30 已经过 10-01 … 10-11 共 11 次
    expect(d.skippedBefore).toBe(10);
  });

  it('积压三天 → 只判一次要跑，但跳过次数是 2（今天这次不算跳过）', () => {
    const d = asFire(decideFire({ ...task(), lastRunAt: ISO(2026, 10, 9, 12) }, new Date(2026, 9, 12, 15)));
    expect(d.skippedBefore).toBe(2);
    // 补跑之后下一次是明天，不是"把欠的再排一遍"
    expect(d.nextDueAt).toBe(ISO(2026, 10, 13, 9));
  });

  it('报出"补的是哪一次"：水位线要写成那一次，不能写成此刻', () => {
    const d = asFire(decideFire({ ...task(), lastRunAt: ISO(2026, 10, 9, 12) }, new Date(2026, 9, 12, 15)));
    // 写成"此刻 15:00"会把今天 09:00 这一次当成已跑过，而它恰恰就是这次要补的那一笔
    expect(d.dueAt).toBe(ISO(2026, 10, 12, 9));
  });

  it('抖动只推迟"什么时候醒"，不改变"补的是哪一次"', () => {
    const d = asFire(
      decideFire(
        { ...task({ jitterMs: 20 * 60_000 }), lastRunAt: ISO(2026, 10, 11, 9, 30) },
        new Date(2026, 9, 12, 9, 30),
      ),
    );
    expect(d.dueAt).toBe(ISO(2026, 10, 12, 9));
  });

  it('从没跑过的新任务：创建当天那个时刻已经过了 → 今天不补（今天这次不算错过）', () => {
    const d = decideFire(task({ anchorAt: ISO(2026, 10, 12, 12) }), new Date(2026, 9, 12, 15));
    expect(d.kind).toBe('none');
    if (d.kind === 'none') expect(d.nextDueAt).toBe(ISO(2026, 10, 13, 9));
  });

  it('从没跑过的新任务：创建时还没到今天的时刻 → 今天照跑', () => {
    expect(decideFire(task({ anchorAt: ISO(2026, 10, 12, 8) }), new Date(2026, 9, 12, 9, 1)).kind).toBe('fire');
  });

  it('抖动把这一次往后推：没过"到点 + 抖动"就还不算到', () => {
    const base = { ...task({ jitterMs: 10 * 60_000 }), lastRunAt: ISO(2026, 10, 11, 9, 30) };
    expect(decideFire(base, new Date(2026, 9, 12, 9, 5)).kind).toBe('none');
    expect(decideFire(base, new Date(2026, 9, 12, 9, 11)).kind).toBe('fire');
  });

  it('界面上的下一次时间要把抖动算进去（显示 09:00 却 09:40 才跑 = 骗人）', () => {
    const d = decideFire(
      { ...task({ jitterMs: 40 * 60_000 }), lastRunAt: ISO(2026, 10, 11, 9, 30) },
      new Date(2026, 9, 12, 8, 30),
    );
    expect(d.kind).toBe('none');
    if (d.kind === 'none') expect(d.nextDueAt).toBe(ISO(2026, 10, 12, 9, 40));
  });

  it('补跑之后不许把同一批积压再补一遍（下一个 tick 只看新的）', () => {
    const overdue = { ...task(), lastRunAt: ISO(2026, 10, 9, 12) };
    expect(asFire(decideFire(overdue, new Date(2026, 9, 12, 15))).skippedBefore).toBe(2);
    // 补跑把 lastRunAt 推到"此刻"，于是同一批三天旧账不再重演
    const after = { ...task(), lastRunAt: ISO(2026, 10, 12, 15) };
    expect(decideFire(after, new Date(2026, 9, 12, 15, 1)).kind).toBe('none');
  });

  it('按分这种高频规则，积压十次也只判一次要跑', () => {
    const d = asFire(
      decideFire({ ...task({ ruleText: 'FREQ=MINUTELY' }), lastRunAt: ISO(2026, 10, 12, 9, 0) }, new Date(2026, 9, 12, 9, 10)),
    );
    expect(d.skippedBefore).toBe(9);
  });
});

describe('规则坏了必须说出来，不许静默不跑', () => {
  it('认不出的规则 → invalid + 带着解析的错误原文', () => {
    const d = decideFire(task({ ruleText: 'FREQ=MONTHLY' }), new Date(2026, 9, 12, 9, 30));
    expect(d.kind).toBe('invalid');
    if (d.kind === 'invalid') expect(d.error).toContain('MONTHLY');
  });

  it('锚点是脏数据（不是个时刻）→ 也是 invalid，不是"当没这条任务"', () => {
    const d = decideFire(task({ anchorAt: '昨天吧' }), new Date(2026, 9, 12, 9, 30));
    expect(d.kind).toBe('invalid');
    if (d.kind === 'invalid') expect(d.error).toContain('锚点');
  });

  it('lastRunAt 是脏数据 → 按"从没跑过"处理，但把话说在 warning 里（不许静默当 null）', () => {
    const d = asFire(decideFire({ ...task(), lastRunAt: 'not-a-date' }, new Date(2026, 9, 12, 9, 30)));
    expect(d.warning).toContain('lastRunAt');
  });
});

describe('跳过次数的说法', () => {
  it('0 次就是一条都不说（界面不会凭空多一行"跳过了 0 次"）', () => {
    expect(describeSkipped(0)).toBe('');
  });

  it('一次：说清楚是补跑，且说明只补一次', () => {
    expect(describeSkipped(1)).toContain('跳过 1 次');
    expect(describeSkipped(1)).toContain('只补最近一次');
  });

  it('多次：报数', () => {
    expect(describeSkipped(3)).toContain('跳过 3 次');
  });

  it('负数当 0 处理（上游算错也不许写出"跳过 -1 次"这种话）', () => {
    expect(describeSkipped(-2)).toBe('');
  });
});
