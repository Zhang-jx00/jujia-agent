import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT_TAIL_CHARS, streamEventSchema } from './index';

/**
 * 流式事件契约（R8.7 加了一类：`tool_output`）。
 *
 * 为什么值得单独立一个文件：`preload` 在把事件交给界面之前会 `streamEventSchema.safeParse`，
 * **不合契约的直接丢弃**。也就是说"主进程发了、界面没显示"这件事的断点就在这张表上 ——
 * 新加一类事件而忘了改进契约，症状是"实时输出静默不出现"，正好是本项目最忌的那一类。
 */

const base = { sessionId: 's-1' };

describe('streamEventSchema · tool_output', () => {
  it('合法形状通过：会话号 + 哪一次调用 + 尾部快照', () => {
    const r = streamEventSchema.safeParse({
      ...base,
      type: 'tool_output',
      callId: 'c-1',
      name: 'run_command',
      tail: '第一段\n第二段\n',
    });
    expect(r.success).toBe(true);
  });

  it('空尾巴也收（"命令开始跑了但还没出东西"是一次真实状态，不是缺字段）', () => {
    const r = streamEventSchema.safeParse({ ...base, type: 'tool_output', callId: 'c-1', name: 'x', tail: '' });
    expect(r.success).toBe(true);
  });

  it('超过上限的尾部被拒（不是截断 —— 上界由主进程负责，契约负责把它挡在门外）', () => {
    const r = streamEventSchema.safeParse({
      ...base,
      type: 'tool_output',
      callId: 'c-1',
      name: 'x',
      tail: 'x'.repeat(TOOL_OUTPUT_TAIL_CHARS + 1),
    });
    expect(r.success).toBe(false);
  });

  it('少了 callId 就拒：一次回答可以连调几个工具，分不清是谁的输出就会串到别的气泡上（T5 同形）', () => {
    const r = streamEventSchema.safeParse({ ...base, type: 'tool_output', name: 'x', tail: 'a' });
    expect(r.success).toBe(false);
  });

  it('每一类流事件都必须带 sessionId —— 全局广播靠它筛归属，缺一个就等于允许跨会话污染', () => {
    const variants = [
      { type: 'text_delta', messageId: 'm', seq: 0, delta: 'x' },
      { type: 'tool_start', callId: 'c', name: 'n', argumentsText: '{}' },
      { type: 'tool_end', callId: 'c', name: 'n', ok: true, summary: 's', durationMs: 1 },
      { type: 'tool_output', callId: 'c', name: 'n', tail: 'x' },
      { type: 'usage', inputTokens: 1, outputTokens: 2 },
      { type: 'error', code: 'e', message: 'm' },
      { type: 'done', reason: 'stop' },
    ];
    for (const v of variants) {
      expect(streamEventSchema.safeParse(v).success, `${v.type} 缺 sessionId 时应当被拒`).toBe(false);
      expect(streamEventSchema.safeParse({ ...base, ...v }).success, `${v.type} 应当被收`).toBe(true);
    }
  });

  it('未知类型仍然一律拒（不给"以后随便加一类事件"留松口子）', () => {
    const r = streamEventSchema.safeParse({ ...base, type: 'tool_progress', tail: 'x' });
    expect(r.success).toBe(false);
  });
});
