/**
 * 定时任务的触发时刻算式（M7 · R9）—— **只做子集，且子集外的一律拒收**。
 *
 * 支持：`FREQ=MINUTELY|HOURLY|DAILY|WEEKLY` + `INTERVAL` + `BYDAY`（仅按周）+ `BYHOUR`/`BYMINUTE`。
 * 不支持：`UNTIL`、`COUNT`、`MONTHLY`、`YEARLY`、按月末日、时区 —— 解析阶段直接报错，
 * **不是"看不懂就忽略"**：填了不生效的开关比没有这个开关更坏（用户在界面上会以为设了截止日期）。
 *
 * 两条口径写在这里，服务和界面共用一处：
 * ① **墙上时间**：按用户手表走（按日 / 按周看的是本地日历日与星期，不是 UTC 的 86400000 毫秒）。
 * ② **锚点**：这条任务最早可能触发的那一刻。`hour`/`minute` 为空表示"跟着锚点的时刻走"。
 *
 * 日期加减一律走日历字段（`shiftDays`），不加 `n * 86400000`：起点是本地零点，
 * 跨夏令时那天加整 24 小时会落到 23:00，于是日期差一天 —— 按日重复的任务会在"该跳过的日子"触发。
 */

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * JS 的 `getDay()`（0 = 周日）换算到 ISO 顺序（0 = 周一）的表，**只在这一处**。
 * 用 0..6 的字面量键而不是数组下标：`getDay()` 返回的是 `number`，数组取下标在
 * `noUncheckedIndexedAccess` 下会得到 `Weekday | undefined`，逼着人写"越界就抛"这种永远走不到的分支。
 */
const BY_JS_DAY = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' } as const;

export function weekdayOfDate(d: Date): Weekday {
  return BY_JS_DAY[d.getDay() as keyof typeof BY_JS_DAY];
}

/** 某个星期几在 ISO 顺序里排第几（0 = 周一）。按周重复的日子偏移只认这一个出处 */
export function weekdayOffset(w: Weekday): number {
  const at = WEEKDAYS.indexOf(w);
  if (at < 0) throw new Error(`认不出的星期：${w}`);
  return at;
}

export type Frequency = 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY';

export interface RRule {
  freq: Frequency;
  interval: number;
  byDay: Weekday[];
  hour: number | null;
  minute: number | null;
}

export type RuleParseResult = { ok: true; rule: RRule } | { ok: false; error: string };

const FREQUENCIES: Frequency[] = ['MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY'];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/* -------------------------- 墙上时间的小工具 -------------------------- */

/** 本地日历日的零点 */
function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 日历日偏移（见文件头：不用整 24 小时相加） */
function shiftDays(baseMs: number, days: number): Date {
  const d = new Date(baseMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** 本周一的零点 —— 按周的锚点 */
function weekStart(d: Date): number {
  const day = new Date(midnight(d)).getDay();
  const offsetFromMonday = day === 0 ? 6 : day - 1;
  return shiftDays(midnight(d), -offsetFromMonday).getTime();
}

function addDays(baseMs: number, days: number, hour: number, minute: number): Date {
  const shifted = shiftDays(baseMs, days);
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), hour, minute, 0, 0);
}

function roundDays(a: number, b: number): number {
  return Math.round((a - b) / DAY_MS);
}

/** 规则没写时刻就跟着锚点那一刻（两处共用，不各写一遍 `??`） */
function clockHour(rule: RRule, anchor: Date): number {
  return rule.hour ?? anchor.getHours();
}

function clockMinute(rule: RRule, anchor: Date): number {
  return rule.minute ?? anchor.getMinutes();
}

/** 这条规则在一周里挑中的日子（ISO 偏移，升序）；没写 BYDAY 就跟着锚点那天 */
function chosenOffsets(rule: RRule, anchor: Date): number[] {
  const days = rule.byDay.length > 0 ? rule.byDay : [weekdayOfDate(anchor)];
  return days.map(weekdayOffset).sort((a, b) => a - b);
}

/** 某一整周（`weekMs` = 那周周一零点）里、这条规则挑中的各个日子 */
function weekOccurrences(rule: RRule, anchor: Date, weekMs: number): Date[] {
  const hour = clockHour(rule, anchor);
  const minute = clockMinute(rule, anchor);
  return chosenOffsets(rule, anchor)
    .map((offset) => addDays(weekMs, offset, hour, minute))
    .sort((a, b) => a.getTime() - b.getTime());
}

function periodMs(rule: RRule): number {
  return rule.freq === 'MINUTELY' ? rule.interval * MINUTE_MS : rule.interval * HOUR_MS;
}

/* ------------------------------- 解析 ------------------------------- */

/** 整数解析：不是整数就返回 null（0 / 负数 / 1.5 / 空串都算非法，交给调用方报错） */
function parseInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  return Number.parseInt(raw.trim(), 10);
}

export function parseRule(text: string): RuleParseResult {
  const parts = text
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '');

  const kv = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) return { ok: false, error: `看不懂这一段「${part}」：应当是 键=值 的形式（例如 FREQ=DAILY）` };
    kv.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim().toUpperCase());
  }

  const freqRaw = kv.get('FREQ');
  if (freqRaw === undefined || freqRaw === '') {
    return { ok: false, error: '缺少 FREQ：至少要说明按什么重复（FREQ=MINUTELY / HOURLY / DAILY / WEEKLY）' };
  }
  if (!(FREQUENCIES as string[]).includes(freqRaw)) {
    return { ok: false, error: `这个版本不支持 FREQ=${freqRaw}（只支持 MINUTELY / HOURLY / DAILY / WEEKLY）` };
  }
  const freq = freqRaw as Frequency;
  const usesClock = freq === 'DAILY' || freq === 'WEEKLY';

  const intervalRaw = kv.has('INTERVAL') ? parseInteger(kv.get('INTERVAL') as string) : 1;
  if (intervalRaw === null || intervalRaw < 1) {
    return { ok: false, error: 'INTERVAL 必须是不小于 1 的整数（0、负数、小数都不行）' };
  }

  let hour: number | null = null;
  let minute: number | null = null;
  if (kv.has('BYHOUR')) {
    if (!usesClock) {
      return { ok: false, error: `FREQ=${freq} 不能配 BYHOUR：按分 / 按时看的是间隔，指定几点只会让人以为能限定时段` };
    }
    const v = parseInteger(kv.get('BYHOUR') as string);
    if (v === null || v < 0 || v > 23) return { ok: false, error: 'BYHOUR 必须是 0 到 23 的整数' };
    hour = v;
  }
  if (kv.has('BYMINUTE')) {
    if (!usesClock) {
      return { ok: false, error: `FREQ=${freq} 不能配 BYMINUTE：按分 / 按时看的是间隔，指定分钟同理` };
    }
    const v = parseInteger(kv.get('BYMINUTE') as string);
    if (v === null || v < 0 || v > 59) return { ok: false, error: 'BYMINUTE 必须是 0 到 59 的整数' };
    minute = v;
  }

  const byDay: Weekday[] = [];
  if (kv.has('BYDAY')) {
    if (freq !== 'WEEKLY') return { ok: false, error: 'BYDAY 只在 FREQ=WEEKLY 时有意义（按日重复没法指定星期几）' };
    const raw = (kv.get('BYDAY') as string)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (raw.length === 0) return { ok: false, error: 'BYDAY 是空的：要指定星期几就写 MO / TU / WE / TH / FR / SA / SU' };
    const seen = new Set<string>();
    for (const token of raw) {
      if (!(WEEKDAYS as readonly string[]).includes(token)) {
        return { ok: false, error: `BYDAY 里有认不出的「${token}」（可用：MO / TU / WE / TH / FR / SA / SU）` };
      }
      if (seen.has(token)) return { ok: false, error: `BYDAY 里「${token}」重复了` };
      seen.add(token);
      byDay.push(token as Weekday);
    }
  }

  for (const key of kv.keys()) {
    if (key === 'FREQ' || key === 'INTERVAL' || key === 'BYHOUR' || key === 'BYMINUTE' || key === 'BYDAY') continue;
    return { ok: false, error: `这个版本不支持 ${key}（认得 FREQ / INTERVAL / BYDAY / BYHOUR / BYMINUTE）` };
  }

  return { ok: true, rule: { freq, interval: intervalRaw, byDay, hour, minute } };
}

/* ------------------------------- 算式 ------------------------------- */

/** 这条规则最早可能的那一次（锚点之前的一概不算，任务那时还不存在） */
function firstOccurrence(rule: RRule, anchor: Date): Date {
  if (rule.freq === 'MINUTELY' || rule.freq === 'HOURLY') return anchor;
  const hour = clockHour(rule, anchor);
  const minute = clockMinute(rule, anchor);
  if (rule.freq === 'DAILY') return addDays(midnight(anchor), 0, hour, minute);
  const offsets = chosenOffsets(rule, anchor);
  return addDays(weekStart(anchor), Math.min(...offsets), hour, minute);
}

/**
 * 严格晚于 `after` 的下一次触发。
 * 估一个起点再小步校正：按日历日 / 按周估 index，最多往前挪几步，步数有上界（不是循环找）。
 */
export function nextOccurrence(rule: RRule, anchor: Date, after: Date): Date {
  if (rule.freq === 'MINUTELY' || rule.freq === 'HOURLY') {
    const step = periodMs(rule);
    let k = Math.max(0, Math.floor((after.getTime() - anchor.getTime()) / step) + 1);
    let cand = new Date(anchor.getTime() + k * step);
    while (cand.getTime() <= after.getTime()) {
      k += 1;
      cand = new Date(anchor.getTime() + k * step);
    }
    return cand;
  }

  const hour = clockHour(rule, anchor);
  const minute = clockMinute(rule, anchor);

  if (rule.freq === 'DAILY') {
    const base = midnight(anchor);
    let n = Math.max(0, Math.floor(roundDays(midnight(after), base) / rule.interval));
    let cand = addDays(base, n * rule.interval, hour, minute);
    while (cand.getTime() <= after.getTime()) {
      n += 1;
      cand = addDays(base, n * rule.interval, hour, minute);
    }
    return cand;
  }

  const baseWeek = weekStart(anchor);
  const weekSpan = rule.interval * 7;
  let w = Math.max(0, Math.floor(roundDays(weekStart(after), baseWeek) / weekSpan));
  for (;;) {
    const hit = weekOccurrences(rule, anchor, shiftDays(baseWeek, w * weekSpan).getTime()).find(
      (d) => d.getTime() > after.getTime(),
    );
    if (hit !== undefined) return hit;
    w += 1;
  }
}

/**
 * 截至 `t`（含）最后一次发生的那一次；一次都还没有过 → null。
 *
 * 补跑要把水位线写成**被补的那一次**，而不是"此刻"：写成此刻会把
 * "此刻之前刚发生、还没跑"的那一笔静默抹掉（下一算就从它之后起了）。
 */
export function occurrenceAtOrBefore(rule: RRule, anchor: Date, t: Date): Date | null {
  if (rule.freq === 'MINUTELY' || rule.freq === 'HOURLY') {
    const k = Math.floor((t.getTime() - anchor.getTime()) / periodMs(rule));
    return k < 0 ? null : new Date(anchor.getTime() + k * periodMs(rule));
  }

  const hour = clockHour(rule, anchor);
  const minute = clockMinute(rule, anchor);

  if (rule.freq === 'DAILY') {
    const base = midnight(anchor);
    let n = Math.floor(roundDays(midnight(t), base) / rule.interval);
    for (let guard = 0; guard < 4; guard += 1) {
      if (n < 0) return null;
      const cand = addDays(base, n * rule.interval, hour, minute);
      if (cand.getTime() <= t.getTime()) return cand.getTime() < anchor.getTime() ? null : cand;
      n -= 1;
    }
    return null;
  }

  const baseWeek = weekStart(anchor);
  const weekSpan = rule.interval * 7;
  let w = Math.floor(roundDays(weekStart(t), baseWeek) / weekSpan);
  for (let guard = 0; guard < 4; guard += 1) {
    if (w < 0) return null;
    const inWeek = weekOccurrences(rule, anchor, shiftDays(baseWeek, w * weekSpan).getTime()).filter(
      (d) => d.getTime() <= t.getTime(),
    );
    const last = inWeek[inWeek.length - 1];
    if (last !== undefined) return last.getTime() < anchor.getTime() ? null : last;
    w -= 1;
  }
  return null;
}

/** 从锚点到 `upto`（含）一共出现过多少次 */
function occurrencesThrough(rule: RRule, anchor: Date, upto: Date): number {
  const first = firstOccurrence(rule, anchor);
  if (upto.getTime() < first.getTime()) return 0;

  if (rule.freq === 'MINUTELY' || rule.freq === 'HOURLY') {
    return Math.floor((upto.getTime() - anchor.getTime()) / periodMs(rule)) + 1;
  }

  const hour = clockHour(rule, anchor);
  const minute = clockMinute(rule, anchor);

  if (rule.freq === 'DAILY') {
    const base = midnight(anchor);
    const n = Math.max(0, Math.floor(roundDays(midnight(upto), base) / rule.interval));
    const cand = addDays(base, n * rule.interval, hour, minute);
    return cand.getTime() <= upto.getTime() ? n + 1 : n;
  }

  const baseWeek = weekStart(anchor);
  const offsets = chosenOffsets(rule, anchor);
  const weekSpan = rule.interval * 7;
  const w = Math.max(0, Math.floor(roundDays(weekStart(upto), baseWeek) / weekSpan));
  const inWeek = weekOccurrences(rule, anchor, shiftDays(baseWeek, w * weekSpan).getTime()).filter(
    (d) => d.getTime() <= upto.getTime(),
  ).length;
  return w * offsets.length + inWeek;
}

/**
 * 区间 `(from, to]` 里出现过多少次 —— 补跑口径的算术底子。
 * 左开右闭是刻意的：刚跑过的那一次不算"错过"，否则每次重启都要多补一次。
 */
export function countOccurrences(rule: RRule, anchor: Date, from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  return Math.max(0, occurrencesThrough(rule, anchor, to) - occurrencesThrough(rule, anchor, from));
}

/**
 * 抖动：同一 id 永远得到同一个偏移量（重启后不许换点 —— 换了就会被当成"还没跑过"再补一次）。
 * FNV-1a 的 32 位哈希：够用、无依赖，且不依赖时间或 locale。
 */
export function jitterMs(seed: string, windowMs: number): number {
  if (windowMs <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % windowMs;
}
