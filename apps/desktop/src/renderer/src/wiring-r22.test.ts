/**
 * 界面交互群源锁（T40 · 加固15 · R22）。
 *
 * 这批修复的共同形状：**界面上的"没反应"与"谎报"** —— 用普通组件测试逐条复现
 * 成本高（要摆出流中/并发/损坏等现场），但每条都有一个非常明确的源码不变量：
 * 旧写法必须绝迹、新守卫必须在位。对照口径：`chat-honesty-wiring.test.ts`（R21）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('界面交互群源锁（T40 · 加固15）', () => {
  const chat = read('./features/chat/ChatPanel.tsx');

  it('send 有"流式中"守卫；翻页有在飞保护；失败都说话', () => {
    expect(chat).toMatch(/async function send[\s\S]{0,320}if \(sending\) return;/);
    expect(chat).toMatch(/if \(olderBusy\) return;/);
    expect(chat).toContain('读更早的消息失败');
    expect(chat).toContain('停止失败');
    // 翻页按钮真的被在飞状态锁住（不是只加了 state 却没人用）
    expect(chat).toMatch(/loadOlder\(\)\}\s*\n\s*disabled=\{olderBusy\}/);
  });

  it('「谁在流」按会话记账：切回可续见、可停（T40-② · R23 的正确修法）', () => {
    // 派生式发送态（armed 或本会话在流）——不允许退回单一布尔
    expect(chat).toContain('streamingIds.has(sessionId)');
    expect(chat).not.toContain('setSending');
    // done/error 的扣账必须在会话闸门**之前**（闸门会把别的会话事件丢掉，扣晚了集合永远不干净）：
    // 用位置断言（正则会被文件里更早的 setStreamingIds 撞上）
    const book = chat.indexOf('这是"切回能续见、能停"的记账来源');
    expect(book).toBeGreaterThan(-1);
    const gate = chat.indexOf('if (!belongsToSession(event, sessionIdRef.current)) return;', book);
    expect(gate).toBeGreaterThan(book);
    // 会话切换不再顺手清 sending（旧病根）
    expect(chat).toMatch(/function resetView\(\): void \{[\s\S]{0,200}不再清 sending/);
  });

  it('审批队列按 id 移除（slice(1) 竞态不许回来）', () => {
    const dialog = read('./features/permission/PermissionDialog.tsx');
    expect(dialog).not.toMatch(/setQueue\(\(prev\) => prev\.slice\(1\)\)/);
    expect(dialog).toMatch(/filter\(\(r\) => r\.id !== request\.id\)/);
  });

  it('结束会话：失败不许再宣布"已结束"（旧 catch 吞法绝迹）', () => {
    const tp = read('./features/terminal/TerminalPanel.tsx');
    expect(tp).not.toContain('void window.jujia.terminalKill(id).catch(() => undefined)');
    expect(tp).toContain('结束会话失败');
  });

  it('工作区信息读失败与"还没选择工作区"分开说', () => {
    const ide = read('./features/ide/IdePanel.tsx');
    expect(ide).toContain('工作区信息读不出来');
    expect(ide).toMatch(/rootError !== null[\s\S]{0,200}还没选择工作区/);
  });

  it('画布视口真的回放（setViewport），不是只写 ref 没人看', () => {
    const cv = read('./features/canvas/CanvasPanel.tsx');
    expect(cv).toMatch(/setViewport\(viewportRef\.current\)/);
  });
});
