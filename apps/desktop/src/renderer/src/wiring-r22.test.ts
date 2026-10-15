/**
 * 界面交互群源锁（T40 · 加固15 · R22）。
 *
 * 这批修复的共同形状：**界面上的"没反应"与"谎报"** —— 用普通组件测试逐条复现
 * 成本高（要摆出流中/并发/损坏等现场），但每条都有一个非常明确的源码不变量：
 * 旧写法必须绝迹、新守卫必须在位。对照口径：`chat-honesty-wiring.test.ts`（R21）。
 *
 * 文件名带 R22 是它的**出生批次**，不是准入条件：后续轮次的渲染层源码锁也加在这里
 * （T45 的装配接线、T46 的视口锚点迁移都是），因为判据同类、`read()` 的相对路径也同一套。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * 去掉注释后的源码（T58 起这里要用它）。
 *
 * 为什么：**"旧写法必须绝迹"这类否定断言，判据只能落在代码上**。
 * 我第一条这样的锁写完就红了 —— 不是因为分支还在，而是因为我留在原地的那段解释注释里
 * 写着 `event.reason === 'tool_calls'`。同一形状的反面更危险：注释里写一句"已删除 X"
 * 就能让一条否定锁常年绿灯（M268 撞过的那个坑的镜像）。
 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
    // T46 把视口从 ref 换成状态（memo 读 `ref.current` 必然读到过期值），锚点因此从
    // `setViewport(viewportRef.current)` 跟到 `setViewport(parsed.data.viewport)`。
    // **锁判的还是同一件事**：读回来的视口要交给 React Flow，而不是写进没人看的地方。
    // "保存时的视口必须是当下那一个"由 memo-ref.test.ts（T46）钉，这里不重复。
    expect(cv).toMatch(/setViewport\(parsed\.data\.viewport\)/);
  });
});

describe('失败兜底的装配接线（T45 · 审计清零批）', () => {
  it('装配根装上监听、App 挂上组件 —— 缺一条就是"接口有、界面上没有"', () => {
    // 行为面在 ui/failure-notice.test.tsx（jsdom 里真渲染、真派发 unhandledrejection）；
    // 这里只钉"接线"那两环：漏装监听 = 兜底从来不会触发，而全仓其它测试照旧全绿。
    const main = read('./main.tsx');
    const app = read('./App.tsx');
    expect(main).toMatch(/installFailureReporter\(\)/);
    expect(app).toContain('<FailureNotices />');
    // 组件与安装函数必须来自同一个模块（第二份实现就是第二个口径）
    expect(main).toMatch(/from '\.\/ui\/failure-notice'/);
    expect(app).toMatch(/from '\.\/ui\/failure-notice'/);
  });
});

/**
 * T58（终端与外部件批 · 2026-10-15）：**上游不会发的枚举成员，界面也不许留着读它**。
 *
 * 两条同形的死分支（`done.reason` 的 `tool_calls` / `permissionExpired.reason` 的 `cancelled`）
 * 修法是同一句话：把"怎么说"从**散落的 if/三元**改成**以契约为键的穷举表**。
 * 行为面在 `features/chat/done-notice.test.ts` 与 `features/permission/expired-notice.test.ts`
 * （表键集合与契约成员集合对账）；这里钉的是"旧写法绝迹"——
 * 因为表可以存在，而回调里那句 `reason === 'tool_calls'` 也可以同时存在（人改写时最容易忘的就是删旧的）。
 */
describe('结束原因与作废原因都走穷举表，不留死分支（T58 源锁）', () => {
  const panel = strip(read('./features/chat/ChatPanel.tsx'));
  const dialog = strip(read('./features/permission/PermissionDialog.tsx'));

  it('对话页不再按 tool_calls 说话（那条分支永远走不到，留着就是骗下一个读代码的人）', () => {
    expect(panel).not.toMatch(/reason === 'tool_calls'/);
    expect(panel).not.toMatch(/本轮在工具调用处结束了/);
    // 而截断那句话仍然要说 —— 清死分支不许顺手把活的路径关了
    expect(panel).toMatch(/truncationNotice\(event\.reason\)/);
  });

  it('审批弹窗不再用三元兜底作废原因（非 timeout 一律说成"窗口已关闭"正是它撒过的谎）', () => {
    expect(dialog).not.toMatch(/reason === 'timeout' \?/);
    expect(dialog).toMatch(/expiredNotice\(reason\)/);
    expect(dialog).toMatch(/from '\.\/expired-notice'/);
  });

  it('主进程那一侧的结束原因取自契约，不是手抄一份字面量（抄出来的那份多了一个 tool_calls）', () => {
    const service = strip(readFileSync(new URL('../../main/chat-service.ts', import.meta.url), 'utf8'));
    expect(service).toMatch(/let resolved: DoneEndReason = 'stop'/);
    expect(service).not.toMatch(/let resolved: 'stop' \|/);
  });
});
