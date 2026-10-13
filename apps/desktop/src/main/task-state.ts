/**
 * 长任务状态机（M17 批一 · R15）的**纯规则层**。
 *
 * 任务 = 会话里的一轮："起轮"时落一条记录，每完成一个工具记一步，轮末按结局收口。
 * 下次读到该会话时，凡是状态还是 `running` 的记录 = 上次进程被崩溃/强退带走 →
 * **读时判定**为 `interrupted`（判定动作幂等，见 `interruptIfRunning`）。
 *
 * 为什么抽出来：`chat-service` 依赖 electron、进不了 vitest，而这一层把"断在第几步"翻译成
 * 人话，说错一格界面与台账都会跟着失真。设计口径见 `docs/DESIGN-M17.md` §二/§四。
 *
 * 两条如实纪律：
 * - **失败的一步也计数**（做过就是做过，成败另记在 `recentSteps[].ok`）；
 * - **超长指令截断要标注**（续跑注入段要交代"原始要求是什么"，不能悄悄少半句）。
 */

import { TASK_STATUSES, type TaskStatusView } from '@jujia/shared-ipc';

export type TaskStatus = TaskStatusView;

export interface TaskStep {
  name: string;
  ok: boolean;
  at: string;
}

export interface TaskRecord {
  taskId: string;
  sessionId: string;
  /** 用户当时的原话（截断带标注）。崩溃轮的 messages 一条都没落盘，续跑就靠它 */
  instruction: string;
  status: TaskStatus;
  startedAt: string;
  updatedAt: string;
  /** 已收到 tool_end 的步骤数 */
  stepsDone: number;
  /** 最近若干步（给"已完成：A ✓ B ✓"这类如实描述用） */
  recentSteps: TaskStep[];
  /** 此刻正在跑的工具名；`interrupted` 时保留 = "断在哪"的证据 */
  runningStep: string | null;
  finishedAt: string | null;
  interruptedAt: string | null;
  resumedAt: string | null;
  resumeCount: number;
}

export const TASK_INSTRUCTION_MAX = 2000;
export const TASK_RECENT_STEPS_K = 12;

const iso = (now: Date): string => now.toISOString();

function clippedInstruction(text: string): string {
  if (text.length <= TASK_INSTRUCTION_MAX) return text;
  return `${text.slice(0, TASK_INSTRUCTION_MAX)}…（已截断，原 ${String(text.length)} 字）`;
}

export function createTask(input: {
  taskId: string;
  sessionId: string;
  instruction: string;
  now: Date;
}): TaskRecord {
  return {
    taskId: input.taskId,
    sessionId: input.sessionId,
    instruction: clippedInstruction(input.instruction),
    status: 'running',
    startedAt: iso(input.now),
    updatedAt: iso(input.now),
    stepsDone: 0,
    recentSteps: [],
    runningStep: null,
    finishedAt: null,
    interruptedAt: null,
    resumedAt: null,
    resumeCount: 0,
  };
}

export function stepStarted(rec: TaskRecord, name: string, now: Date): TaskRecord {
  return { ...rec, runningStep: name, updatedAt: iso(now) };
}

export function stepFinished(rec: TaskRecord, name: string, ok: boolean, now: Date): TaskRecord {
  return {
    ...rec,
    stepsDone: rec.stepsDone + 1,
    recentSteps: [...rec.recentSteps, { name, ok, at: iso(now) }].slice(-TASK_RECENT_STEPS_K),
    runningStep: null,
    updatedAt: iso(now),
  };
}

export function finishTask(
  rec: TaskRecord,
  outcome: 'done' | 'failed' | 'aborted',
  now: Date,
): TaskRecord {
  return { ...rec, status: outcome, finishedAt: iso(now), runningStep: null, updatedAt: iso(now) };
}

/**
 * 读时判定：唯一能把 `running` 翻成 `interrupted` 的地方。
 * 幂等是硬要求：这个函数会被"每次打开会话"调用，重写一次就要多一次磁盘写、
 * 还会把 `updatedAt` 变成"最后一次打开的时间"（那就不再是任务的真实时间线）。
 */
export function interruptIfRunning(
  rec: TaskRecord,
  now: Date,
): { record: TaskRecord; changed: boolean } {
  if (rec.status !== 'running') return { record: rec, changed: false };
  return {
    record: { ...rec, status: 'interrupted', interruptedAt: iso(now), updatedAt: iso(now) },
    changed: true,
  };
}

export function markResumed(rec: TaskRecord, now: Date): TaskRecord {
  return { ...rec, status: 'running', resumedAt: iso(now), resumeCount: rec.resumeCount + 1, updatedAt: iso(now) };
}

export function markDismissed(rec: TaskRecord, now: Date): TaskRecord {
  return { ...rec, status: 'dismissed', runningStep: null, updatedAt: iso(now) };
}

/** 能不能续：`null` = 可以；否则给一句**说得出处境**的理由（不合成一句"不可用"） */
export function resumeBlockReason(rec: TaskRecord): string | null {
  switch (rec.status) {
    case 'interrupted':
      return null;
    case 'running':
      return '这个任务正在运行中，等它跑完或先停止';
    case 'dismissed':
      return '这条任务已经处理过了（你点过「不再提示」）';
    default:
      return '这条任务已经结束了，没有要续的部分';
  }
}

/**
 * 卡片上那句"断在哪"的如实描述。只对 `interrupted` 说话；别的状态返回空串——
 * 对已完成的任务显示"上次被打断"就是撒谎。
 * 步骤名来自记录本身（最近若干步），但**只列前 6 个**：更早的用"等"收尾，
 * 卡片是给一眼看的，不是把 recentSteps 原样倒出来。
 */
export function describeInterruption(rec: TaskRecord): string {
  if (rec.status !== 'interrupted') return '';
  const listed = rec.recentSteps.slice(-6).map((s) => `${s.name} ${s.ok ? '成功' : '失败'}`);
  const names = listed.length === 0 ? '' : `（${listed.join('、')}${rec.stepsDone > listed.length ? ' 等' : ''}）`;
  const done =
    rec.stepsDone === 0 ? '还没有完成任何步骤' : `已完成 ${String(rec.stepsDone)} 步${names}`;
  const running =
    rec.runningStep === null ? '' : `，中断时正在运行 ${rec.runningStep}（结果未落盘）`;
  return (
    '上一轮任务在应用退出/崩溃时中断（不是模型答完）。' +
    `${done}${running}；中断前那次回答没有留存（本应用只在每轮结束时落盘）。`
  );
}

/** 盘上读回来的记录先验形状：坏形状一律抛（由调用方按"没有记录"处理，不猜） */
export function validateTaskRecord(input: unknown): TaskRecord {
  const rec = input as TaskRecord;
  if (rec === null || typeof rec !== 'object') throw new Error('任务记录不是对象');
  if (typeof rec.taskId !== 'string' || typeof rec.sessionId !== 'string') {
    throw new Error('任务记录缺少 taskId / sessionId');
  }
  if (typeof rec.instruction !== 'string') throw new Error('任务记录缺少 instruction');
  if (!TASK_STATUSES.includes(rec.status)) throw new Error(`任务记录状态非法：${String(rec.status)}`);
  if (typeof rec.stepsDone !== 'number') throw new Error('任务记录 stepsDone 不是数字');
  if (!Array.isArray(rec.recentSteps)) throw new Error('任务记录 recentSteps 不是数组');
  return rec;
}
