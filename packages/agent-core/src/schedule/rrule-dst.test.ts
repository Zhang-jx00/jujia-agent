// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';

/**
 * "按日历走"这条口径的**跨时区红证**（M7 · R9）。
 *
 * 为什么单开一个文件、还要动 `TZ`：`shiftDays` 若退回"加整 24 小时"，
 * 在多伦多/纽约这类**有夏令时**的时区里，跨过秋季回拨那天会落到前一天 23:00 ——
 * 日期凭空差一天，"隔天一次"的任务会在不该跑的日子跑。而在没有夏令时的时区（本机就是）
 * 两种写法结果逐字相同，**这个缺陷在这里根本观测不到**：M194 第一轮校准就是这么逃掉的。
 *
 * 所以：把这个文件的进程时区设成 `America/New_York`（Node 在运行时改 `process.env.TZ`
 * 后续的 `Date` 运算按新时区走，本机实测有效），再断言"跨过 2026-11-01 回拨之后，
 * 隔 2 天的那一次仍然落在第 2 天、时刻仍然是 09:00"。
 *
 * 注意（写给以后改测试配置的人）：本文件依赖"每个测试文件一个独立 worker"（vitest 默认）
 * 与 `isolate: false` 不兼容 —— 真开了那个开关，请在 `afterAll` 之外另想办法隔离时区。
 * 这里仍然铺了 `afterAll` 还原，尽量少留副作用。
 */

const ORIGINAL_TZ = process.env['TZ'];
process.env['TZ'] = 'America/New_York';

// 动过 TZ 之后再加载被测模块：模块里的 `new Date` 才会按新时区算
const { nextOccurrence, countOccurrences, parseRule } = await import('./rrule');

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

const okRule = (text: string) => {
  const parsed = parseRule(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rule;
};

describe('夏令时回拨那一天：日历日不许被"整 24 小时"带跑', () => {
  it('时区确实是纽约（不然这文件什么都没测）', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');
  });

  it('2026-11-01 回拨之后，隔 2 天的那一次是 11-02 09:00，不是 11-01', () => {
    // 11-01 02:00 EDT 回拨到 01:00 EST；从 10-31 起算"加 48 小时"会落到 11-01 23:00
    const rule = okRule('FREQ=DAILY;INTERVAL=2;BYHOUR=9');
    const next = nextOccurrence(rule, at(2026, 10, 31), at(2026, 10, 31, 10));
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(10); // 11 月
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it('数次数也不许把回拨那天少算/多算一次', () => {
    const rule = okRule('FREQ=DAILY;INTERVAL=2;BYHOUR=9');
    // 发生序列：10-31、11-02、11-04、11-06 …（从锚点那天起每隔两天）
    expect(countOccurrences(rule, at(2026, 10, 31), at(2026, 10, 31, 10), at(2026, 11, 6, 10))).toBe(3);
  });
});
