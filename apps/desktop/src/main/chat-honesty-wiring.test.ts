/**
 * 诚实化源锁（加固14 · 2026-10-14，T40 审计项：
 * "工作区提示每轮追加且永不退场" + "淘汰日志无条件断言历史已落盘"）。
 *
 * 为什么用扫源码：chat-service 起不了 vitest（需要 Electron 环境），
 * 但这两条的**不变量**非常明确 —— 旧的坏写法必须绝迹、新的好写法必须留在原位。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./chat-service.ts', import.meta.url), 'utf8');

describe('工作区提示与淘汰话术（chat-service 源锁）', () => {
  it('未选工作区的提示不往消息数组里逐轮追加', () => {
    // 旧形态：push 一条 role:'system' 的"尚未选择工作区"（每轮一条、永不退场）
    expect(src).not.toMatch(/messages\.push\(\{[\s\S]{0,80}尚未选择工作区/);
    // 新形态：常量并入系统提示的一次性重拼（headParts）
    expect(src).toContain('NO_WORKSPACE_NOTICE');
    expect(src).toMatch(/headParts = \[[\s\S]{0,120}NO_WORKSPACE_NOTICE/);
  });

  it('淘汰日志不再无条件声称"历史已落盘"', () => {
    expect(src).toContain('已从内存卸载最久未使用的会话');
    // flush 是异步的，写失败另有单独报错 —— "已落盘"这个无条件断言不许回来
    expect(src).not.toContain('历史已落盘，重启后仍可继续');
  });

  it('落盘失败经 done.notice 上界面（R25：不再只进 console）', () => {
    expect(src).toContain('这一轮没能写进磁盘历史');
    expect(src).toMatch(/async function flushSession\(s: Session\): Promise<string \| null>/);
    expect(src).toMatch(/const persistError = await flushSession\(session\);/);
    // done 事件契约里这条通道在位（渲染层才有得读）
    const contracts = readFileSync(
      new URL('../../../../packages/shared-ipc/src/contracts.ts', import.meta.url),
      'utf8',
    );
    const doneBlock = contracts.slice(
      contracts.indexOf("type: z.literal('done')"),
      contracts.indexOf('export type StreamEvent'),
    );
    expect(doneBlock).toContain('notice: z.string().nullable().default(null)');
    // 渲染层真的把它说出来了（不是契约里挂着一个没人读的字段）
    const panel = readFileSync(
      new URL('../renderer/src/features/chat/ChatPanel.tsx', import.meta.url),
      'utf8',
    );
    expect(panel).toContain('setHistoryHint(event.notice)');
  });
});
