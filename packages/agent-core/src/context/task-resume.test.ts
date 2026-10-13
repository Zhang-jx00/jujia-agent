import { describe, expect, it } from 'vitest';
import { buildTaskResumeSection } from './task-resume';

/**
 * 续跑注入段（M17 批一 · R15）：模型能靠它"从中断处继续"，而**不靠重放动作**。
 *
 * 三条会被写错就撒谎的东西，逐句钉住：
 * ① 出处（"由应用记录、非用户此刻的话"）—— 少了这句，模型会把记录当用户新指令；
 * ② 已完成步骤"不要重做"**与**中断时正在运行的那一步"必须重做"是两句相反的话，各说各的对象；
 * ③ 数字如实：步数与"更早的 N 步未列出"都从记录本身来，不编造进度。
 */

const base = {
  sessionId: 'sess-1',
  instruction: '把报告写出来并发我邮箱',
  stepsDone: 2,
  recentSteps: [
    { name: 'read_file', ok: true },
    { name: 'write_file', ok: false },
  ],
  runningStep: 'run_command',
};

describe('buildTaskResumeSection', () => {
  it('标题写明出处：由应用记录、非用户此刻的话（少了这句就是把记录当新指令）', () => {
    const text = buildTaskResumeSection(base);
    expect(text).toContain('被中断的任务');
    expect(text).toContain('非用户此刻的话');
  });

  it('原始要求逐字引用（续跑的对象就是它）', () => {
    expect(buildTaskResumeSection(base)).toContain('「把报告写出来并发我邮箱」');
  });

  it('已完成步骤列出成败；中断时正在运行的那一步被点名"必须重做它"', () => {
    const text = buildTaskResumeSection(base);
    expect(text).toContain('已完成 2 步');
    expect(text).toContain('read_file 成功');
    expect(text).toContain('write_file 失败');
    expect(text).toContain('正在运行 run_command');
    expect(text).toContain('必须重做');
  });

  it('两句方向相反的话各说各的对象：已完成不重做 / 断在半途的那一步重做', () => {
    const text = buildTaskResumeSection(base);
    expect(text).toContain('已完成的步骤不要重做');
    // 断在半途的那一步没落结果，不重做就永远缺那块 —— 必须在同一段里说清
    expect(text.indexOf('必须重做')).toBeGreaterThan(-1);
  });

  it('中断时没有在跑的工具 → 不提"重建中那一步"（不能对着空气说重做）', () => {
    const text = buildTaskResumeSection({ ...base, runningStep: null });
    expect(text).not.toContain('必须重做');
    expect(text).not.toContain('正在运行');
  });

  it('零步：说"还没有完成任何步骤"，不编造进度', () => {
    const text = buildTaskResumeSection({ ...base, stepsDone: 0, recentSteps: [], runningStep: null });
    expect(text).toContain('还没有完成任何步骤');
  });

  it('步骤数超出列出的部分要如实交代"更早的 N 步未列出"', () => {
    const recent = Array.from({ length: 12 }, (_, i) => ({ name: `tool-${String(i)}`, ok: true }));
    const text = buildTaskResumeSection({ ...base, stepsDone: 20, recentSteps: recent, runningStep: null });
    expect(text).toContain('已完成 20 步');
    expect(text).toContain('更早的 8 步未列出');
  });

  it('这一轮没有文字要求（纯图消息）→ 如实写"没有文字内容"，不凭空编一句', () => {
    const text = buildTaskResumeSection({ ...base, instruction: '   ' });
    expect(text).toContain('没有文字内容');
  });

  it('出处行指向盘上的记录文件（可核对）', () => {
    expect(buildTaskResumeSection(base)).toContain('sessions/sess-1/task.json');
  });

  it('有副作用的动作会再次向用户确认 —— 这句要在（硬约束的告知面）', () => {
    expect(buildTaskResumeSection(base)).toContain('再次向用户确认');
  });
});
