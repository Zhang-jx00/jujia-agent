import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  countOccurrences,
  jitterMs,
  nextOccurrence,
  occurrenceAtOrBefore,
  parseRule,
} from './rrule';

/**
 * 定时任务的**触发时刻算式**（M7 · R9）。
 *
 * 为什么单独立一个纯模块：调度服务要依赖 electron（读磁盘、发 IPC），vitest 里加载不了；
 * 而"下一次是几点""错过几次"这两件事**必须逐字一致** —— 服务算一套、界面显示另一套，
 * 用户看到"下次 09:00"而实际 10:00 跑，是那种没人会报 bug、只会再也不信这功能的错。
 * 所以这里做全部算式，服务和界面都只调这一处。
 *
 * 只做子集：按分 / 按时 / 按日 / 按周 + 具体时刻 + 间隔 + 周内某天。
 * UNTIL / COUNT / MONTHLY / YEARLY **一律拒收**（不是"忽略"，是拒绝保存 ——
 * "填了也不生效的开关比没有更坏"）。
 */

/** 本地墙上时间（这个应用是单用户桌面工具，按用户手表走，不按 UTC） */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

const okRule = (text: string) => {
  const parsed = parseRule(text);
  if (!parsed.ok) throw new Error(`解析应当成功，实际：${parsed.error}`);
  return parsed.rule;
};

const errMsg = (text: string): string => {
  const parsed = parseRule(text);
  if (parsed.ok) throw new Error(`解析应当失败，实际解析成 ${JSON.stringify(parsed.rule)}`);
  return parsed.error;
};

describe('RRULE 子集的解析：支持的都要真支持，不支持的必须拒绝', () => {
  it('按日 + 具体时刻', () => {
    expect(okRule('FREQ=DAILY;BYHOUR=8;BYMINUTE=30')).toEqual({
      freq: 'DAILY',
      interval: 1,
      byDay: [],
      hour: 8,
      minute: 30,
    });
  });

  it('间隔缺省是 1，写了就取写的', () => {
    expect(okRule('FREQ=DAILY;INTERVAL=2').interval).toBe(2);
    expect(okRule('FREQ=DAILY').interval).toBe(1);
  });

  it('按周可以指定周内某几天', () => {
    expect(okRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9').byDay).toEqual(['MO', 'WE', 'FR']);
  });

  it('按分 / 按时不接受"具体时刻"这种半吊子写法（会被静默忽略，所以直接拒）', () => {
    expect(errMsg('FREQ=MINUTELY;BYHOUR=8')).toContain('BYHOUR');
    expect(errMsg('FREQ=HOURLY;BYMINUTE=30')).toContain('BYMINUTE');
  });

  it('按日 / 按周不认 BYDAY（选了也不会生效，所以拒）', () => {
    expect(errMsg('FREQ=DAILY;BYDAY=MO')).toContain('BYDAY');
  });

  it('子集之外的都拒收：MONTHLY、YEARLY、UNTIL、COUNT', () => {
    expect(errMsg('FREQ=MONTHLY')).toContain('MONTHLY');
    expect(errMsg('FREQ=YEARLY')).toContain('YEARLY');
    expect(errMsg('FREQ=DAILY;UNTIL=20261231T000000Z')).toContain('UNTIL');
    expect(errMsg('FREQ=DAILY;COUNT=10')).toContain('COUNT');
  });

  it('认不出的键一律拒收，而不是默默放过', () => {
    expect(errMsg('FREQ=DAILY;BYYEAR=2026')).toContain('BYYEAR');
  });

  it('间隔必须是不小于 1 的整数（0 和负数会把每一次都算成"现在"）', () => {
    expect(errMsg('FREQ=DAILY;INTERVAL=0')).toContain('INTERVAL');
    expect(errMsg('FREQ=DAILY;INTERVAL=-2')).toContain('INTERVAL');
    expect(errMsg('FREQ=DAILY;INTERVAL=1.5')).toContain('INTERVAL');
  });

  it('时刻越界拒收（25 点不是任何一个时刻）', () => {
    expect(errMsg('FREQ=DAILY;BYHOUR=25')).toContain('BYHOUR');
    expect(errMsg('FREQ=DAILY;BYMINUTE=60')).toContain('BYMINUTE');
  });

  it('BYDAY 里有认不出的日子就整条拒收（不是"认出的那几天照常"）', () => {
    expect(errMsg('FREQ=WEEKLY;BYDAY=MO,XX')).toContain('XX');
  });

  it('空串 / 没有 FREQ 都拒收，且错误里说清楚要什么', () => {
    expect(errMsg('')).toContain('FREQ');
    expect(errMsg('INTERVAL=2')).toContain('FREQ');
  });

  it('分隔符允许尾随分号与空格（人手抄一条规则常多打一个）', () => {
    expect(okRule(' FREQ=DAILY;BYHOUR=8; ').hour).toBe(8);
  });

  it('一周的日子只有一处定义，顺序固定（界面文案与解析共用）', () => {
    expect(WEEKDAYS).toEqual(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
  });
});

describe('下一次触发：严格晚于给定时刻，且按墙上时间走', () => {
  it('今天的时刻还没过 → 就是今天', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    expect(nextOccurrence(rule, at(2026, 10, 1), at(2026, 10, 12, 8, 59))).toEqual(at(2026, 10, 12, 9));
  });

  it('今天的时刻已经过了 → 明天（不许原地返回今天）', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    expect(nextOccurrence(rule, at(2026, 10, 1), at(2026, 10, 12, 9, 0))).toEqual(at(2026, 10, 13, 9));
  });

  it('间隔 2 天：跳过的那一天不许出现', () => {
    const rule = okRule('FREQ=DAILY;INTERVAL=2;BYHOUR=9');
    const first = nextOccurrence(rule, at(2026, 10, 12), at(2026, 10, 12, 9, 1));
    expect(first).toEqual(at(2026, 10, 14, 9));
  });

  it('跨月不许漂（按日最容易出现"31 号变 1 号"的错）', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=23;BYMINUTE=59');
    expect(nextOccurrence(rule, at(2026, 1, 31), at(2026, 1, 31, 23, 59))).toEqual(at(2026, 2, 1, 23, 59));
    expect(nextOccurrence(rule, at(2026, 2, 27), at(2026, 2, 27, 23, 59))).toEqual(at(2026, 2, 28, 23, 59));
    expect(nextOccurrence(rule, at(2028, 2, 27), at(2028, 2, 27, 23, 59))).toEqual(at(2028, 2, 28, 23, 59));
    expect(nextOccurrence(rule, at(2026, 12, 31), at(2026, 12, 31, 23, 59))).toEqual(at(2027, 1, 1, 23, 59));
  });

  it('按周：从锚点那一周的下一个符合的日子开始', () => {
    const rule = okRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9');
    // 锚点是 2026-10-09（周五），那一周（周一起）的周一/周三已经过去，周五 09:00 还没到
    expect(nextOccurrence(rule, at(2026, 10, 9), at(2026, 10, 9, 0))).toEqual(at(2026, 10, 9, 9));
    expect(nextOccurrence(rule, at(2026, 10, 9), at(2026, 10, 12, 9))).toEqual(at(2026, 10, 14, 9));
    expect(nextOccurrence(rule, at(2026, 10, 9), at(2026, 10, 16, 10))).toEqual(at(2026, 10, 19, 9));
  });

  it('按周不写 BYDAY 就按锚点所在的那一天重复', () => {
    const rule = okRule('FREQ=WEEKLY;BYHOUR=9');
    // 锚点 2026-10-09 是周五 → 下一个周五 10-16
    expect(nextOccurrence(rule, at(2026, 10, 9), at(2026, 10, 9, 10))).toEqual(at(2026, 10, 16, 9));
  });

  it('按周 + 间隔 2 周：中间那一周整周不许出现', () => {
    const rule = okRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9');
    expect(nextOccurrence(rule, at(2026, 10, 5), at(2026, 10, 5, 9, 1))).toEqual(at(2026, 10, 19, 9));
  });

  it('按分 / 按时不看锚点是几点，只看间隔', () => {
    expect(nextOccurrence(okRule('FREQ=MINUTELY;INTERVAL=5'), at(2026, 10, 12, 9, 3), at(2026, 10, 12, 9, 5))).toEqual(
      at(2026, 10, 12, 9, 8),
    );
    expect(nextOccurrence(okRule('FREQ=HOURLY;INTERVAL=3'), at(2026, 10, 12, 1), at(2026, 10, 12, 2))).toEqual(
      at(2026, 10, 12, 4),
    );
  });

  it('锚点在未来也必须给答案（新建任务当天就想跑，不能返回 null 让界面显示"未知"）', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    expect(nextOccurrence(rule, at(2026, 11, 1), at(2026, 10, 12, 12))).toEqual(at(2026, 11, 1, 9));
  });
});

describe('补跑要知道补的是哪一次：锚点之前不算', () => {
  it('取"截至此刻最近的那一次"，边界算在内', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 1), at(2026, 10, 12, 9))).toEqual(at(2026, 10, 12, 9));
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 1), at(2026, 10, 12, 8, 59))).toEqual(at(2026, 10, 11, 9));
  });

  it('锚点之前那一天/那一刻不算（任务还不存在，不能拿它当"刚跑过"的水位线）', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    // 锚点是 10-10 12:00，那么 10-10 09:00 这一次在任务存在之前就该被排除
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 10, 12), at(2026, 10, 10, 11))).toBe(null);
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 10, 12), at(2026, 10, 11, 9))).toEqual(at(2026, 10, 11, 9));
  });

  it('按分：整步往前取，边界算在内；取不到给 null', () => {
    const rule = okRule('FREQ=MINUTELY;INTERVAL=5');
    // 锚点 09:03 → 09:08、09:13…；t 恰好压在一次上就算那一次
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 12, 9, 3), at(2026, 10, 12, 9, 13))).toEqual(
      at(2026, 10, 12, 9, 13),
    );
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 12, 9, 3), at(2026, 10, 12, 9, 12))).toEqual(
      at(2026, 10, 12, 9, 8),
    );
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 12, 9, 3), at(2026, 10, 12, 9, 2))).toBe(null);
  });

  it('按周：在同一周里往前挑，挑不到退到上一周', () => {
    const rule = okRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9');
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 9), at(2026, 10, 16, 10))).toEqual(at(2026, 10, 16, 9));
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 9), at(2026, 10, 16, 8))).toEqual(at(2026, 10, 14, 9));
    expect(occurrenceAtOrBefore(rule, at(2026, 10, 9), at(2026, 10, 9, 8))).toBe(null);
  });
});

describe('错过的次数（补跑口径的算术底子）', () => {
  it('数的是 (from, to] 里的次数 —— 刚跑过的那一次不许算错过', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    expect(countOccurrences(rule, at(2026, 10, 1), at(2026, 10, 12, 9), at(2026, 10, 12, 20))).toBe(0);
    expect(countOccurrences(rule, at(2026, 10, 1), at(2026, 10, 12, 9), at(2026, 10, 13, 10))).toBe(1);
  });

  it('关机三天 → 三次（补跑只补一次，但那三次必须说出来）', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    expect(countOccurrences(rule, at(2026, 10, 1), at(2026, 10, 10, 12), at(2026, 10, 13, 12))).toBe(3);
  });

  it('按周只数符合的那几天', () => {
    const rule = okRule('FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9');
    // 周五 10-09、周一 10-12、周五 10-16 三次；周一 10-05 那次等于"刚刚跑过"，不数
    expect(countOccurrences(rule, at(2026, 10, 5), at(2026, 10, 5, 10), at(2026, 10, 16, 12))).toBe(3);
  });

  it('from 早于锚点也不许把锚点之前的事务数进来', () => {
    const rule = okRule('FREQ=DAILY;BYHOUR=9');
    // 锚点 10-10 当天的 09:00 算第一次；10-09 及更早不许进来
    expect(countOccurrences(rule, at(2026, 10, 10), at(2026, 1, 1), at(2026, 10, 12, 12))).toBe(3);
  });

  it('to 早于 from 给 0，不返回负数', () => {
    const rule = okRule('FREQ=MINUTELY');
    expect(countOccurrences(rule, at(2026, 10, 1), at(2026, 10, 12, 9, 5), at(2026, 10, 12, 9, 1))).toBe(0);
  });
});

describe('抖动：同一任务重启后不许换点（否则每次都像"刚刚跑过"）', () => {
  it('同一个 id 每次算出同一个值', () => {
    expect(jitterMs('task-abc', 60_000)).toBe(jitterMs('task-abc', 60_000));
  });

  it('落在 [0, 窗口) 内', () => {
    for (const id of ['a', 'b', 'c', '任务一', 'zzz-9']) {
      const v = jitterMs(id, 60_000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(60_000);
    }
  });

  it('不同 id 不许全都撞在同一个值上', () => {
    const set = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => jitterMs(id, 60_000)));
    expect(set.size).toBeGreaterThan(1);
  });

  it('窗口为 0 时给 0（关掉抖动的开关必须真的关掉）', () => {
    expect(jitterMs('task-abc', 0)).toBe(0);
  });
});
