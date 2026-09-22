import { describe, expect, it } from 'vitest';
import { sessionStart, stopTurn, userPromptSubmit, HOOK_CONTEXT_MARKER } from './points';
import type { HookRunParams, HookRunner, HookRunResult } from './types';

/** 记录调用并返回预设结果的假运行器（真进程行为在 runner.test.ts 里验） */
function fake(result: Partial<HookRunResult> = {}): { runner: HookRunner; calls: HookRunParams[] } {
  const calls: HookRunParams[] = [];
  return {
    calls,
    runner: {
      async run(params: HookRunParams): Promise<HookRunResult> {
        calls.push(params);
        return {
          blocked: false,
          reason: null,
          additionalContext: [],
          updatedInput: null,
          permissionDecision: null,
          permissionReason: null,
          continueTurn: false,
          diagnostics: [],
          ranCount: 0,
          ...result,
        };
      },
    },
  };
}

const ctx = { sessionId: 's1', cwd: 'D:/ws' };

describe('回合级钩子接入点（W5d-b）', () => {
  it('SessionStart：把附加上下文格式化好，来源作为匹配目标', async () => {
    const { runner, calls } = fake({ additionalContext: ['本项目用 pnpm', '先读 AGENTS.md'] });
    const out = await sessionStart(runner, ctx);
    expect(out.context).toContain(HOOK_CONTEXT_MARKER);
    expect(out.context).toContain('本项目用 pnpm');
    expect(calls[0]?.event).toBe('SessionStart');
    expect(calls[0]?.matchTarget).toBe('startup');
    expect(calls[0]?.payload['source']).toBe('startup');
  });

  it('SessionStart：没有附加上下文时返回空串（调用方不必判空）', async () => {
    const out = await sessionStart(fake().runner, ctx);
    expect(out.context).toBe('');
  });

  it('UserPromptSubmit：匹配目标是提示词原文，拦下时带出理由', async () => {
    const { runner, calls } = fake({ blocked: true, reason: '这个仓库不许提删除命令' });
    const out = await userPromptSubmit(runner, ctx, '帮我把 D 盘清空');
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('不许提删除命令');
    expect(calls[0]?.matchTarget).toBe('帮我把 D 盘清空');
  });

  it('UserPromptSubmit：附带上下文格式化一致', async () => {
    const out = await userPromptSubmit(fake({ additionalContext: ['记得用中文回答'] }).runner, ctx, 'hi');
    expect(out.blocked).toBe(false);
    expect(out.context).toBe(`${HOOK_CONTEXT_MARKER}\n记得用中文回答`);
  });

  it('Stop：匹配目标是会话 id，并要求"再走一步"时如实带出', async () => {
    const { runner, calls } = fake({ continueTurn: true, additionalContext: ['你还没跑测试'] });
    const out = await stopTurn(runner, ctx, '我改完了');
    expect(out.continueTurn).toBe(true);
    expect(out.context).toContain('你还没跑测试');
    expect(calls[0]?.event).toBe('Stop');
    expect(calls[0]?.matchTarget).toBe('s1');
    expect(calls[0]?.payload['text']).toBe('我改完了');
  });

  it('Stop：最终文本过长时截断后再交给钩子（避免灌爆它的 stdin）', async () => {
    const { runner, calls } = fake();
    await stopTurn(runner, ctx, 'x'.repeat(10_000));
    expect(String(calls[0]?.payload['text']).length).toBe(4_000);
  });
});
