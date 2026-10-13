/**
 * 续跑注入段（M17 批一 · R15）：把"被中断的任务"交给模型的那一段系统提示。
 *
 * 口径与 `buildSummarySection` 同一套：**出处写在段首与段尾**（模型必须知道
 * 这是应用记录、不是用户此刻说的话），数字只从记录来。
 *
 * 这段文本里有一对**方向相反**的指令，各说各的对象，写错任一都是真事故：
 * - **已完成的步骤不要重做**（重做 = 重复副作用）；
 * - **中断时正在运行的那一步必须重做**（它的结果没落盘，不重做就永远缺那一块）。
 * 两条都有单测逐句钉着 —— 漂移就是语义漂移。
 */

export interface TaskResumeInput {
  sessionId: string;
  instruction: string;
  stepsDone: number;
  recentSteps: ReadonlyArray<{ name: string; ok: boolean }>;
  /** 中断时正在跑的工具名；null = 中断时没有在跑的东西（如正在等模型回复） */
  runningStep: string | null;
}

export function buildTaskResumeSection(input: TaskResumeInput): string {
  const listed = input.recentSteps.map((s) => `${s.name} ${s.ok ? '成功' : '失败'}`);
  const omitted = input.stepsDone - listed.length;
  const doneText =
    input.stepsDone === 0
      ? '还没有完成任何步骤'
      : `已完成 ${String(input.stepsDone)} 步${listed.length === 0 ? '' : `：${listed.join('、')}${
          omitted > 0 ? `（更早的 ${String(omitted)} 步未列出）` : ''
        }`}`;

  const instruction = input.instruction.trim() === '' ? '（没有文字内容）' : input.instruction.trim();

  const runningText =
    input.runningStep === null
      ? ''
      : `\n中断时正在运行 ${input.runningStep}：它的结果没有落盘，**必须重做它**。`;

  return (
    `## 被中断的任务（续跑，由应用记录，非用户此刻的话）\n` +
    `上一轮任务在应用退出/崩溃时中断（不是模型答完）。用户当时的原始要求：\n` +
    `「${instruction}」\n` +
    `${doneText}。${runningText}\n` +
    `请从中断处继续完成这个任务；**已完成的步骤不要重做**；有副作用的动作会再次向用户确认。\n` +
    `来源：sessions/${input.sessionId}/task.json`
  );
}
