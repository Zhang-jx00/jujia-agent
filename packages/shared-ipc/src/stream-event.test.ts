import { describe, expect, it } from 'vitest';
import {
  DONE_END_REASONS,
  PERMISSION_EXPIRED_REASONS,
  TOOL_OUTPUT_TAIL_CHARS,
  permissionExpiredSchema,
  streamEventSchema,
} from './index';

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

/**
 * T58（终端与外部件批 · 2026-10-15）：**契约里有、运行期永不产生**的枚举成员要清掉。
 *
 * 为什么要拦这个方向：`done.reason` 曾声明 `tool_calls`（provider 那一层确实会产，
 * 但它止步于循环，从来不出主进程），而渲染层有一条**活分支**在读它 ——
 * 于是那句话今天永远不显示，而下一个读代码的人会以为"工具调用处结束"这条路径是通的。
 * 界面读得到、上游不发的成员，比缺一个成员更坏：它把注意力骗到一条不存在的路径上。
 *
 * 同形第二条：`permissionExpired.reason` 曾声明 `cancelled`，桥里只发 `timeout` 与
 * `window-closed`，而弹窗那侧写的是 `reason === 'timeout' ? A : B` —— 若将来真补上 cancelled，
 * 它会被说成"窗口已关闭"。清掉成员之后，界面那张说明表改成穷举 `Record`：**新增即编译不过**。
 */
describe('结束原因的枚举里不许有"运行期永不产生"的成员（T58）', () => {
  it('done 不再收 tool_calls：主进程从未发过它', () => {
    expect(streamEventSchema.safeParse({ ...base, type: 'done', reason: 'tool_calls' }).success).toBe(false);
  });

  it('契约成员清单就是那五个，一个不多（新增成员必须同时改主进程与界面那张表）', () => {
    expect([...DONE_END_REASONS].sort()).toEqual(
      ['aborted', 'content_filter', 'error', 'length', 'stop'].sort(),
    );
  });

  it('审批作废原因不再收 cancelled：桥里只有超时与窗口关闭两条出口', () => {
    expect(permissionExpiredSchema.safeParse({ id: 'p-1', reason: 'cancelled' }).success).toBe(false);
    expect([...PERMISSION_EXPIRED_REASONS].sort()).toEqual(['timeout', 'window-closed']);
  });

  it('留下的成员照样收（清死分支不许顺手把活的路径断了）', () => {
    expect(streamEventSchema.safeParse({ ...base, type: 'done', reason: 'stop' }).success).toBe(true);
    expect(streamEventSchema.safeParse({ ...base, type: 'done', reason: 'content_filter' }).success).toBe(true);
    expect(permissionExpiredSchema.safeParse({ id: 'p-1', reason: 'window-closed' }).success).toBe(true);
  });
});
