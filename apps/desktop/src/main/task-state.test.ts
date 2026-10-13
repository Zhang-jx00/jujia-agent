import { describe, expect, it } from 'vitest';
import {
  TASK_RECENT_STEPS_K,
  createTask,
  describeInterruption,
  finishTask,
  interruptIfRunning,
  markDismissed,
  markResumed,
  resumeBlockReason,
  stepFinished,
  stepStarted,
  validateTaskRecord,
  type TaskRecord,
} from './task-state';

/**
 * 长任务状态机（M17 批一 · R15）的纯规则层。
 *
 * 为什么单独成文件并逐条测：`chat-service` 依赖 electron、在 vitest 里加载不了，
 * 而这一层错的代价是"静默撒谎"——把没做完的任务显示成做完了、或把"断在第几步"记错一格，
 * 界面与台账都会跟着失真。所以每条转换都写成断言，且用固定时间戳（同一时刻两次判定必须一致）。
 */

const T0 = new Date('2026-10-13T20:00:00.000Z');
const T1 = new Date('2026-10-13T20:00:05.000Z');
const T2 = new Date('2026-10-13T20:00:10.000Z');

const fresh = (): TaskRecord =>
  createTask({ taskId: 't-1', sessionId: 's-1', instruction: '把报告写出来', now: T0 });

describe('createTask：起轮那一刻就有一条如实记录', () => {
  it('字段齐全、初始 running、没有已完成的步骤', () => {
    const rec = fresh();
    expect(rec.status).toBe('running');
    expect(rec.stepsDone).toBe(0);
    expect(rec.recentSteps).toEqual([]);
    expect(rec.runningStep).toBeNull();
    expect(rec.finishedAt).toBeNull();
    expect(rec.interruptedAt).toBeNull();
    expect(rec.resumeCount).toBe(0);
    expect(rec.startedAt).toBe(T0.toISOString());
  });

  it('超长指令截断**如实标注**（续跑时要靠它交代"原始要求是什么"）', () => {
    const long = 'x'.repeat(2_500);
    const rec = createTask({ taskId: 't', sessionId: 's', instruction: long, now: T0 });
    expect(rec.instruction.length).toBeLessThan(long.length);
    expect(rec.instruction).toContain('已截断');
    expect(rec.instruction).toContain('2500');
  });
});

describe('步进的记录：计数与尾部清单各守各的用途', () => {
  it('tool_start 记 runningStep，tool_end 计数 +1 并清掉 runningStep', () => {
    const started = stepStarted(fresh(), 'run_command', T1);
    expect(started.runningStep).toBe('run_command');
    expect(started.stepsDone).toBe(0);
    const done = stepFinished(started, 'run_command', true, T2);
    expect(done.runningStep).toBeNull();
    expect(done.stepsDone).toBe(1);
    expect(done.recentSteps).toEqual([{ name: 'run_command', ok: true, at: T2.toISOString() }]);
  });

  it('recentSteps 只留最近 K 步（旧的原样退出，不是从头截）', () => {
    let rec = fresh();
    for (let i = 0; i < TASK_RECENT_STEPS_K + 3; i += 1) {
      rec = stepFinished(stepStarted(rec, `tool-${String(i)}`, T1), `tool-${String(i)}`, i % 2 === 0, T2);
    }
    expect(rec.stepsDone).toBe(TASK_RECENT_STEPS_K + 3);
    expect(rec.recentSteps).toHaveLength(TASK_RECENT_STEPS_K);
    expect(rec.recentSteps[0]?.name).toBe('tool-3');
    expect(rec.recentSteps[rec.recentSteps.length - 1]?.name).toBe(`tool-${String(TASK_RECENT_STEPS_K + 2)}`);
  });

  it('失败的一步也计数（做过就是做过，成败另记）', () => {
    const rec = stepFinished(fresh(), 'run_command', false, T2);
    expect(rec.stepsDone).toBe(1);
    expect(rec.recentSteps[0]?.ok).toBe(false);
  });
});

describe('结局与判定', () => {
  it('finishTask 三种结局都落 finishedAt 并清掉 runningStep', () => {
    for (const outcome of ['done', 'failed', 'aborted'] as const) {
      const rec = stepStarted(fresh(), 'run_command', T1);
      const fin = finishTask(rec, outcome, T2);
      expect(fin.status).toBe(outcome);
      expect(fin.finishedAt).toBe(T2.toISOString());
      expect(fin.runningStep).toBeNull();
    }
  });

  it('读时判定：running → interrupted，且**保留 runningStep**（那是"断在哪"的证据）', () => {
    const rec = stepStarted(fresh(), 'run_command', T1);
    const { record, changed } = interruptIfRunning(rec, T2);
    expect(changed).toBe(true);
    expect(record.status).toBe('interrupted');
    expect(record.interruptedAt).toBe(T2.toISOString());
    expect(record.runningStep).toBe('run_command');
  });

  it('读时判定必须幂等：已 interrupted 的再读不重写、updatedAt 不动', () => {
    const rec = interruptIfRunning(fresh(), T1).record;
    const again = interruptIfRunning(rec, T2);
    expect(again.changed).toBe(false);
    expect(again.record.updatedAt).toBe(rec.updatedAt);
  });

  it('会话还活着（进程内有一轮正在跑）时不许判：running 保持 running —— 定时轮次不该被读成"被打断"', () => {
    const rec = stepStarted(fresh(), 'run_command', T1);
    const { record, changed } = interruptIfRunning(rec, T2, true);
    expect(changed).toBe(false);
    expect(record.status).toBe('running');
    expect(record.interruptedAt).toBeNull();
  });

  it('"活着"只对 running 有影响：已 interrupted 的仍幂等不动（复活不回去）', () => {
    const interrupted = interruptIfRunning(fresh(), T1).record;
    const again = interruptIfRunning(interrupted, T2, true);
    expect(again.changed).toBe(false);
    expect(again.record.status).toBe('interrupted');
  });

  it('已结束的任务不会被读时判定碰（done 就是 done）', () => {
    const done = finishTask(fresh(), 'done', T1);
    expect(interruptIfRunning(done, T2)).toEqual({ record: done, changed: false });
  });

  it('markResumed：回 running、resumeCount+1、原指令一字不动（续的是同一件事）', () => {
    const interrupted = interruptIfRunning(fresh(), T1).record;
    const resumed = markResumed(interrupted, T2);
    expect(resumed.status).toBe('running');
    expect(resumed.resumeCount).toBe(1);
    expect(resumed.resumedAt).toBe(T2.toISOString());
    expect(resumed.instruction).toBe(interrupted.instruction);
    expect(resumed.stepsDone).toBe(interrupted.stepsDone);
  });

  it('markDismissed：关掉之后状态不再回 running、也不清空历史步数', () => {
    const interrupted = stepFinished(fresh(), 'read_file', true, T1);
    const dis = markDismissed(interruptIfRunning(interrupted, T1).record, T2);
    expect(dis.status).toBe('dismissed');
    expect(dis.stepsDone).toBe(1);
  });
});

describe('resumeBlockReason：能不能续，各给各的实话', () => {
  it('interrupted 是唯一可续的状态', () => {
    expect(resumeBlockReason(interruptIfRunning(fresh(), T1).record)).toBeNull();
  });

  it('其余状态各有各的理由，不合成一句', () => {
    expect(resumeBlockReason(fresh())).toContain('运行中');
    expect(resumeBlockReason(finishTask(fresh(), 'done', T1))).toContain('结束了');
    expect(resumeBlockReason(finishTask(fresh(), 'failed', T1))).toContain('结束了');
    expect(resumeBlockReason(finishTask(fresh(), 'aborted', T1))).toContain('结束了');
    expect(resumeBlockReason(markDismissed(interruptIfRunning(fresh(), T1).record, T1))).toContain('不再提示');
  });
});

describe('describeInterruption：卡片上那句话必须与事实一一对应', () => {
  it('零步：说"还没有完成任何步骤"，不编造进度', () => {
    const rec = interruptIfRunning(fresh(), T1).record;
    const text = describeInterruption(rec);
    expect(text).toContain('还没有完成任何步骤');
    expect(text).toContain('中断前那次回答没有留存');
  });

  it('带 runningStep：如实说"中断时正在运行 X（结果未落盘）"', () => {
    const rec = interruptIfRunning(stepStarted(fresh(), 'run_command', T1), T2).record;
    const text = describeInterruption(rec);
    expect(text).toContain('正在运行 run_command');
    expect(text).toContain('结果未落盘');
  });

  it('有已完成步数：数字与步骤名都来自记录本身', () => {
    const rec = stepFinished(fresh(), 'read_file', true, T1);
    const text = describeInterruption(interruptIfRunning(rec, T2).record);
    expect(text).toContain('已完成 1 步');
    expect(text).toContain('read_file');
  });

  it('对非 interrupted 记录不适用时返回空串（卡片不该对别的状态说话）', () => {
    expect(describeInterruption(fresh())).toBe('');
    expect(describeInterruption(finishTask(fresh(), 'done', T1))).toBe('');
  });
});

describe('validateTaskRecord：盘上读回来的东西先验形状', () => {
  it('好记录原样通过', () => {
    expect(validateTaskRecord(fresh()).taskId).toBe('t-1');
  });

  it('坏形状一律拒（状态表外词 / 步数不是数 / 缺 sessionId）', () => {
    const good = fresh() as unknown as Record<string, unknown>;
    expect(() => validateTaskRecord({ ...good, status: '删库中' })).toThrow();
    expect(() => validateTaskRecord({ ...good, stepsDone: '三步' })).toThrow();
    expect(() => validateTaskRecord({ ...good, sessionId: undefined })).toThrow();
    expect(() => validateTaskRecord(null)).toThrow();
  });
});
