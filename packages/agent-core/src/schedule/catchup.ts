/**
 * 补跑口径（M7 · R9）—— 纯算式，不碰磁盘也不碰 electron。
 *
 * 一句话：**错过的至多补一次，但"错过了几次"必须说出来。**
 *
 * 为什么不逐次补：一条"每天 09:00"的任务关机一周后开机，连跑七次同样的提醒不是"补上了"，是骚扰；
 * 而一句都不说，用户分不清"到点没到"与"到点了但没跑"（静默失败是头号禁区）。
 *
 * 水位线只有一个：`lastRunAt`。它既表示"上次真跑过"，也表示"这之前的账都结清了"。
 * 补跑写完它，同一个积压不会在下一个 tick 再补一遍 —— 铺设计划 6b 的 `shouldAskAgain`
 * 就是这条的同族教训：把处理过的当成没处理过，就会重复问。
 */

import { countOccurrences, nextOccurrence, occurrenceAtOrBefore, parseRule, type RRule } from './rrule';

export interface CatchUpInput {
  /** 用户写的 RRULE 子集原文（坏了要报出来，不许当没这条任务） */
  ruleText: string;
  /** 这条任务最早可能触发的那一刻（创建时定下，之后不再改） */
  anchorAt: string;
  /** 上一次真触发的时刻；null = 从没跑过 */
  lastRunAt: string | null;
  /** 本条任务的抖动偏移（由 id 派生，重启后不许变 —— 变了就像"还没跑过"） */
  jitterMs: number;
}

export type CatchUpDecision =
  | { kind: 'none'; nextDueAt: string; warning?: string }
  | {
      /** 该跑：`dueAt` 是这次要补/跑的那一次，服务把水位线写成它 */
      kind: 'fire';
      dueAt: string;
      skippedBefore: number;
      nextDueAt: string;
      warning?: string;
    }
  | { kind: 'invalid'; error: string };

/** 下一次该醒的时刻 = 规则算出的那一次 + 抖动；抖动已经算进去了 */
function nextDue(rule: RRule, anchor: Date, after: Date, jitterMs: number): string {
  const base = nextOccurrence(rule, anchor, after);
  return new Date(base.getTime() + jitterMs).toISOString();
}

function warnField(text: string | undefined): Record<'warning', string> | Record<never, never> {
  return text === undefined ? {} : { warning: text };
}

export function decideFire(input: CatchUpInput, now: Date): CatchUpDecision {
  const parsed = parseRule(input.ruleText);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };
  const rule = parsed.rule;

  const anchor = new Date(input.anchorAt);
  if (Number.isNaN(anchor.getTime())) {
    return { kind: 'invalid', error: `锚点不是个时刻：「${input.anchorAt}」` };
  }

  const jitterMs = Number.isFinite(input.jitterMs) && input.jitterMs > 0 ? Math.floor(input.jitterMs) : 0;

  let warning: string | undefined;
  let from: Date;
  if (input.lastRunAt === null || input.lastRunAt === undefined) {
    // 从没跑过：锚点之前的一次都不算，锚点那一刻起都可能算
    from = new Date(anchor.getTime() - 1);
  } else {
    const prev = new Date(input.lastRunAt);
    if (Number.isNaN(prev.getTime())) {
      from = new Date(anchor.getTime() - 1);
      warning = `lastRunAt 读不出来（「${input.lastRunAt}」），这次按"从没跑过"处理`;
    } else {
      from = prev;
    }
  }

  /** 抖动这段时间之内才到的那一次，还不算"到过了" */
  const lookedAt = new Date(now.getTime() - jitterMs);
  const passed = countOccurrences(rule, anchor, from, lookedAt);

  if (passed > 0) {
    const due = occurrenceAtOrBefore(rule, anchor, lookedAt);
    if (due === null) {
      // 两条算式给了不一致的答案（数得出错过、却说不出是哪一次）。
      // 宁可把这句话摊开报出去，也不静默判成"不用跑"—— 后者正是本仓头号禁区
      return { kind: 'invalid', error: `算式对不上：数出 ${String(passed)} 次该跑，却找不到是哪一次` };
    }
    return {
      kind: 'fire',
      dueAt: due.toISOString(),
      skippedBefore: passed - 1,
      // 下一次从"这次补到的那一格"往后排，而不是从此刻往后排：
      // 否则积压三天的任务补完这一次，剩下的两天会被当成"已经过去了"而不再出现
      nextDueAt: nextDue(rule, anchor, due, jitterMs),
      ...warnField(warning),
    };
  }

  // 下一次永远从"此刻与水位线里较晚的那头"往后找：
  // 时钟往回跳过（改系统时间、同步盘）也不许把已经跑过的那一次重新排上日程
  const after = new Date(Math.max(now.getTime(), from.getTime()));
  return { kind: 'none', nextDueAt: nextDue(rule, anchor, after, jitterMs), ...warnField(warning) };
}

/**
 * 跳过次数的说法。0 次（含上游算错的负数）**给空串** ——
 * 界面无条件渲染就会多出一行"跳过了 0 次"，那是噪声，不是信息。
 */
export function describeSkipped(skipped: number): string {
  if (!Number.isFinite(skipped) || skipped <= 0) return '';
  return `补跑：之前跳过 ${skipped} 次（只补最近一次）`;
}
