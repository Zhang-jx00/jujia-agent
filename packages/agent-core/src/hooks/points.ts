/**
 * 钩子的三个"回合级"接入点（W5d-b）。
 *
 * 为什么单独成模块：`sessionStart` / `userPromptSubmit` / `stopTurn` 三处的**结果格式化**
 * 必须一致（怎么拼"补充上下文"、怎么念理由），否则同一个钩子在三个地方会有三种说法。
 * 循环与对话服务都调这里，格式化只写一份，也便于单测（不需要真的跑循环）。
 */

import { type HookRunner, type HookRunResult } from './types';

export interface HookPointContext {
  sessionId: string;
  cwd: string;
}

/** 附加上下文在消息里的统一标记（模型与人都能一眼看出"这是钩子说的，不是用户说的"） */
export const HOOK_CONTEXT_MARKER = '[钩子补充上下文]';

export function formatHookContext(items: ReadonlyArray<string>): string {
  if (items.length === 0) return '';
  return `${HOOK_CONTEXT_MARKER}\n${items.join('\n')}`;
}

export interface SessionStartOutcome {
  /** 要注入系统提示的文本（空 = 无需注入） */
  context: string;
  diagnostics: string[];
}

/**
 * 会话开始。
 *
 * `source`：目前只会是 `startup` —— 本项目**不持久化会话**，所以没有 `resume` 这种来源。
 * 参数仍然保留，是为了将来真做会话恢复时不必改钩子契约（契约稳定比实现完整更优先）。
 */
export async function sessionStart(
  hooks: HookRunner,
  ctx: HookPointContext,
  source: 'startup' | 'resume' = 'startup',
): Promise<SessionStartOutcome> {
  const res: HookRunResult = await hooks.run({
    event: 'SessionStart',
    ...ctx,
    payload: { source },
    matchTarget: source,
  });
  return { context: formatHookContext(res.additionalContext), diagnostics: res.diagnostics };
}

export interface UserPromptSubmitOutcome {
  /** 钩子要求拦下这次提示词（不发模型） */
  blocked: boolean;
  /** 拦下的理由（给用户看） */
  reason: string | null;
  /** 要注入系统提示的文本 */
  context: string;
  diagnostics: string[];
}

export async function userPromptSubmit(
  hooks: HookRunner,
  ctx: HookPointContext,
  prompt: string,
): Promise<UserPromptSubmitOutcome> {
  const res = await hooks.run({
    event: 'UserPromptSubmit',
    ...ctx,
    payload: { prompt },
    matchTarget: prompt,
  });
  return {
    blocked: res.blocked,
    reason: res.reason,
    context: formatHookContext(res.additionalContext),
    diagnostics: res.diagnostics,
  };
}

export interface StopOutcome {
  /** 钩子要求再走一步 */
  continueTurn: boolean;
  /** 追加给模型的要求（拼好后作为一条消息发出去） */
  context: string;
  diagnostics: string[];
}

export async function stopTurn(
  hooks: HookRunner,
  ctx: HookPointContext,
  finalText: string,
): Promise<StopOutcome> {
  const res = await hooks.run({
    event: 'Stop',
    ...ctx,
    payload: { text: finalText.slice(0, 4_000) },
    matchTarget: ctx.sessionId,
  });
  return {
    continueTurn: res.continueTurn,
    context: formatHookContext(res.additionalContext),
    diagnostics: res.diagnostics,
  };
}
