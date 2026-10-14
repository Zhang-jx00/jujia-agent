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
    // 注："流中切会话"的正确修法（按会话的流中状态）**不在这里** —— 硬拦方案被 e2e [26]
    // 当堂否决（切换中流是设计能力），已重排 R23；本文件只锁"不冲突"的那几条。
    expect(chat).toMatch(/if \(olderBusy\) return;/);
    expect(chat).toContain('读更早的消息失败');
    expect(chat).toContain('停止失败');
    // 翻页按钮真的被在飞状态锁住（不是只加了 state 却没人用）
    expect(chat).toMatch(/loadOlder\(\)\}\s*\n\s*disabled=\{olderBusy\}/);
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
