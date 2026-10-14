import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { belongsToSession } from './stream-routing';

/**
 * 流事件的分发闸口（外部审查 T5）。
 *
 * 真实形状是这样的：主进程把 `CHAT_STREAM` **全局广播**，而面板只订阅一次。
 * 增量事件（text_delta）因为要按 messageId 找气泡，切了会话之后看起来"没事"；
 * 但 `done` / `error` / `usage` / `tool_start` / `tool_end` 不需要 messageId，
 * 它们会直接落到当前界面上 —— 于是"上一个会话还没说完"就会把新会话的界面改错：
 * 新会话的输入框被点亮、token 数变成别人的、正在转的工具行被别的会话结束掉。
 */
describe('belongsToSession', () => {
  it('事件属于当前会话 → 放行', () => {
    expect(belongsToSession({ sessionId: 'A' }, 'A')).toBe(true);
  });

  it('事件属于别的会话 → 丢弃（这就是那条污染路径）', () => {
    expect(belongsToSession({ sessionId: 'A' }, 'B')).toBe(false);
  });

  it('还没选定任何会话 → 一律丢弃（空界面上不该画出别人的收尾）', () => {
    expect(belongsToSession({ sessionId: 'A' }, undefined)).toBe(false);
    expect(belongsToSession({ sessionId: 'A' }, '')).toBe(false);
  });

  it('每一类流事件都必须带 sessionId（少了这个字段，上面三条都无从谈起）', () => {
    // 契约在 shared-ipc 里；这里钉的是"契约确实给了这个字段"这一事实。
    // 判据用"成员数 == 带 sessionId 的人数"这种**结构不变量**，不写死"就是 6 类"——
    // 写死条目的锁在本仓已经咬过三次自己人（CSS 锁的子串匹配、check-docs 的段落 indexOf、
    // ide-wiring 的通道清单），而本轮加第七类事件（tool_output）当场又咬了一次。
    const here = dirname(fileURLToPath(import.meta.url));
    // 本文件在 apps/desktop/src/renderer/src/features/chat/ —— 到仓库根要上 7 层
    const contracts = readFileSync(
      join(here, '..', '..', '..', '..', '..', '..', '..', 'packages', 'shared-ipc', 'src', 'contracts.ts'),
      'utf8',
    );
    const block = contracts.slice(
      contracts.indexOf('export const streamEventSchema'),
      contracts.indexOf('export type StreamEvent'),
    );
    const members = (block.match(/type: z\.literal\('([a-z_]+)'\)/g) ?? []).length;
    const withSession = (block.match(/sessionId: z\.string\(\)/g) ?? []).length;
    // 防失焦下限：真的扫到了多类事件（不是段落定位器失效导致两边都是 0 而"相等"）
    expect(members).toBeGreaterThan(5);
    expect(withSession).toBe(members);
  });
});

describe('闸口真的挂在订阅回调的第一行（接线锁）', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const panel = strip(readFileSync(join(here, 'ChatPanel.tsx'), 'utf8'));

  it('onStream：闸门之前只许「谁在流」记账，视图 setter 一个都不许有旁路', () => {
    const at = panel.indexOf("window.jujia.onStream((event: StreamEvent) => {");
    expect(at).toBeGreaterThan(-1);
    const head = panel.slice(at, at + 1400);
    const body = head.slice(head.indexOf('=> {') + 4);
    const gatePos = body.indexOf('if (!belongsToSession(event, sessionIdRef.current)) return;');
    // 闸门仍在（且能在窗口里找到 —— 找不到就红，防失焦）
    expect(gatePos).toBeGreaterThan(-1);
    /**
     * R23 的设计变更（T40-②）：done/error 的「流中集合」扣账必须在闸门**之前**
     * （切走会话的 done 到不了闸门之后，扣晚了集合永远不干净）。
     * 旧锁写的是"回调体第一条语句就是闸门"——那是单一 sending 时代的位置判据；
     * 新判据更强也更贴意图：**闸门之前只允许记账，任何视图分支不许旁路**。
     */
    const prelude = body.slice(0, gatePos);
    expect(prelude).toContain('setStreamingIds');
    expect(prelude).not.toMatch(
      /setBubbles|setUsage|setToolLines|setLastError|setPageHint|setHistoryHint|setNoteHint/,
    );
  });

  it('筛完用的是 ref 而不是 state（订阅只建一次，闭包里的 state 会永远停在第一帧）', () => {
    expect(panel).toContain('belongsToSession(event, sessionIdRef.current)');
    expect(panel).not.toContain('belongsToSession(event, sessionId)');
  });

  it('改 sessionId 只能经 selectSession，ref 与状态一起走', () => {
    expect(panel).toContain('sessionIdRef.current = id;');
    const direct = panel.match(/setSessionId\(/g) ?? [];
    // 只允许出现在 selectSession 那一处
    expect(direct.length).toBe(1);
  });

  /**
   * R23 设计变更（T40-②）后重写的清场锁：
   * 旧设计里"上一个会话的 done 会顺手把 sending 归零"消失了靠换会话清场兜底；现在
   * "谁在流"按会话记账（`streamingIds`），**切走不再清发送态**（切回由集合恢复"续见/可停"）。
   * 新不变量：resetView 只清"这一会话的视图"；发送态只能由派生式记账给出（不许退回单一布尔）。
   */
  it('换会话清场只清"这一会话的视图"；发送态归按会话的记账管', () => {
    const rvAt = panel.indexOf('function resetView()');
    expect(rvAt).toBeGreaterThan(-1);
    const rv = panel.slice(rvAt, rvAt + 400);
    expect(rv).toContain('setUsage(null)');
    expect(rv).not.toContain('setSending');
    // 两条换会话路径仍都走 resetView（这条没变）
    const resumeAt = panel.indexOf('async function resume(');
    const newAt = panel.indexOf('              resetView();');
    expect(resumeAt).toBeGreaterThan(-1);
    expect(newAt).toBeGreaterThan(resumeAt);
    expect(panel.slice(resumeAt, resumeAt + 320)).toContain('resetView();');
  });
});
