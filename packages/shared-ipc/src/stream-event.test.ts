import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DONE_END_REASONS,
  PERMISSION_EXPIRED_REASONS,
  TOOL_OUTPUT_TAIL_CHARS,
  permissionExpiredSchema,
  streamEventSchema,
} from './index';

/** 仓库根（本文件在 packages/shared-ipc/src 下，往上三层）—— 出处对账要读主进程与 agent-core 的源码 */
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

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

  /**
   * 这一条在 R31 被**换了判据**（不是放宽）。
   *
   * 旧写法是"成员清单就是那五个"的字面量对账 —— 于是本轮合法地新增 `no_end_marker` 时它当堂红，
   * 而这正是本仓**第五次**撞见同一个形状（写死现状清单的锁会被合法增长养瞎：CSS 接线锁、
   * check:docs 段落 indexOf、ipc-wiring 生命周期 slice、`sendMessage(` 计数、`.toBe(6)` 事件种类数）。
   * 更糟的是这种红**教人去做错事**：照旧清单删掉新增成员，或者把清单改成六个 ——
   * 后者恰好就是"改阈值不改判据"。
   *
   * 继任的判据是**出处**：契约里的每一个成员，都必须能在真实来源里指出"谁会把这个值发出来" ——
   * ① 主进程 `chat-service.ts` 里有 `resolved = '它'` 这条赋值，或
   * ② agent-core 的 `StreamEnd` 里有它，且循环确实会把它带进 `truncated`（`stop` / `tool_calls` / `aborted`
   *    除外：前两个不进这一格，第三个走的是"用户中止"那条独立的格子）。
   * 这样 T58 治的那个病（**契约里有、运行期永不产生**）照样会被抓住 ——
   * `tool_calls` 既不在出处①（主进程从不赋它），又被出处②的排除项点名，两条都过不了。
   */
  it('契约的每个成员都必须在源码里有出处（谁发这个值说不出来 = 死成员）', () => {
    const main = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'main', 'chat-service.ts'), 'utf8');
    const core = readFileSync(
      join(repoRoot, 'packages', 'agent-core', 'src', 'providers', 'types.ts'),
      'utf8',
    );

    const assigned = new Set(
      [...main.matchAll(/resolved\s*=\s*'([a-z_]+)'/g)].map((m) => m[1] as string),
    );
    /**
     * `StreamEnd` 的成员**不是全写在这一行上的**：`export type StreamEnd = FinishReason | 'tool_calls' | ...`
     * —— 只扫这一行会漏掉 `length` / `content_filter` / `stop`（它们来自 `FinishReason`）。
     * 上一版就栽在这儿：扫到 3 个成员，防失焦那格当场把锁判红（这正是这条下限断言存在的意义）。
     * 所以取**两个声明的并集**，而不是把字面量补回清单。
     */
    const declOf = (name: string): string =>
      new RegExp(`export type ${name} =([^;]+);`, 's').exec(core)?.[1] ?? '';
    const streamEnd = new Set([
      ...`${declOf('StreamEnd')} ${declOf('FinishReason')}`.matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1] as string));
    // 循环吞掉的三个（见 agent-loop 的 done 分支）：它们不会成为 `result.truncated`
    const swallowedByLoop = new Set(['stop', 'tool_calls', 'aborted']);

    // 防失焦：两个解析任一个空转，这条锁就什么都没量到（本仓"扫得太少就等于全过"的老账）
    expect(assigned.size, '主进程里一条 resolved 赋值都没扫到 —— 定位器失效了').toBeGreaterThanOrEqual(3);
    expect(streamEnd.size, 'StreamEnd 的定义没扫到 —— 定位器失效了').toBeGreaterThanOrEqual(4);

    for (const reason of DONE_END_REASONS) {
      const produced =
        assigned.has(reason) || (streamEnd.has(reason) && !swallowedByLoop.has(reason));
      expect(produced, `done 的结束原因 "${reason}" 在源码里没有任何出处（死成员）`).toBe(true);
    }
    // 反向钉住 T58 的那个具体病灶：provider 会产、但止步于循环
    expect(streamEnd.has('tool_calls'), 'StreamEnd 里应当还有 tool_calls（provider 那一层确实会产）').toBe(true);
    expect(DONE_END_REASONS).not.toContain('tool_calls');
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
