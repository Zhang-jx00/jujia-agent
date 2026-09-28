import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * T22 的接线锁（报备 `docs/DESIGN-T22-TAB-STATE.md` §二/§三，批复七条全同意）。
 *
 * 为什么这类锁只认源码：这条修复的正确性有一半**不在任何单个文件里** ——
 * `KeepAlive` 自己是对的，但 `App.tsx` 里若把它接错（或者边缘 key 又退回 `key={tab}`），
 * 状态照样丢，而组件测试与全量单测都会绿。这类"改一行就悄悄失效"的接线，
 * 正是本仓一再用源码锁钉住的东西（同 `browser-wiring` / `compact-wiring` 的理由）。
 *
 * 覆盖边界（别往大里理解）：这里只钉**接线形态**；"切回后订阅真的还在、
 * 消息真的落回原会话"由 e2e 第 32、33 步的真值断言负责。
 */

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const app = read('../renderer/src/App.tsx');
const keepAlive = read('../renderer/src/KeepAlive.tsx');
const chat = read('../renderer/src/features/chat/ChatPanel.tsx');

describe('App：对话页常驻的接线', () => {
  it('对话页挂在 KeepAlive 里，且 active 跟着页签走', () => {
    expect(app).toContain("<KeepAlive active={tab === 'chat'}>");
    expect(app).toContain('<ChatPanel connections={connections} active={tab === \'chat\'} />');
  });

  it('对话页**不再**出现在那个以页签为 key 的共享边界里（否则切页签仍会重挂、状态照样丢）', () => {
    const shared = app.slice(app.indexOf('<ErrorBoundary key={tab}'), app.indexOf('</ErrorBoundary>', app.indexOf('<ErrorBoundary key={tab}') + 1));
    expect(shared).not.toContain('ChatPanel');
    expect(shared).not.toContain("tab === 'chat'");
  });

  it('对话页自己的边界用稳定 key（chat-<轮次>），并接上 onError 拿"这一轮坏了"的通知', () => {
    expect(app).toContain('key={`chat-${String(chatEpoch)}`}');
    expect(app).toContain('onError={markChatBroken}');
    // 离开对话页且它处于错误态 → 轮次 +1：正常态保持、错误态照旧重挂一次
    expect(app).toContain("if (tab === 'chat') return;");
    expect(app).toContain('chatBrokenRef.current = false;');
    expect(app).toContain('setChatEpoch((n) => n + 1);');
  });

  it('懒加载性质保住：没激活过就不挂载（首屏 chunk 与启动时间线不受影响）', () => {
    expect(keepAlive).toContain('if (!everActive) return null;');
    expect(keepAlive).toContain('hidden={!active}');
  });
});

describe('ChatPanel：切回来的滚动补一次', () => {
  it('补滚动的口径与"跟随流式"那条完全一致（原本贴底才贴底，上滚过就不抢）', () => {
    expect(chat).toContain('if (!active || !stickToBottomRef.current) return;');
    // 必须跟着 active 变：写成 [] 就等于永不触发（那时这条修复只是"看起来写了"）
    expect(chat).toContain('}, [active]);');
  });
});
