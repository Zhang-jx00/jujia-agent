// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FailureNotices,
  __resetFailuresForTest,
  installFailureReporter,
  reportFailure,
} from './failure-notice';

/**
 * T45（2026-10-14 审计清零批）：渲染层"没人接的失败"必须有声音。
 *
 * 2026-10-09 审计的 B5 条数到今天只清了一半：界面点得动的关键路径（读历史 / 翻页 / 停止）
 * 都已经 catch 住并写进 hint，但渲染层仍有十几处 `try/finally` **没有 catch** ——
 * IPC 那头的 promise 被拒时，`finally` 只把 busy 标志复位，界面回到"点了没反应"。
 * 逐点补 catch 只能治已发生的十几处，治不了"下一处新写的漏网"，所以这里补的是**这一类**的兜底：
 * `unhandledrejection` → 一条看得见、点得掉的告警。
 *
 * 三条自律（都在下面的用例里钉着）：
 * ① 同一条重复来不许刷屏（连点五次 = 一条卡片 + 次数）；
 * ② 有上限，且**新的必须看得见**（旧的被挤掉，不是新的被丢弃）；
 * ③ 装上必须能撤（返回 cleanup），否则热更新会叠出第二个监听器、一条失败报两遍。
 */

/**
 * 两处都套 `act`：告警是**外部 store** 推出来的更新，而用例是在 React 事件之外直接调它的
 * （真应用里由 `unhandledrejection` 触发）。不套 act 时更新不会被同步刷出来，
 * 断言就会在"已经报了但还没画"的间隙里读到空 —— 那是测试写法的问题，不是实现的错，
 * 别把它当成红灯（2026-10-14 首跑就是这样，八个用例一起红）。
 */
function say(text: string): void {
  act(() => {
    reportFailure(text);
  });
}

function reject(reason: unknown): void {
  act(() => {
    const ev = new Event('unhandledrejection') as Event & { reason: unknown };
    ev.reason = reason;
    window.dispatchEvent(ev);
  });
}

afterEach(() => {
  cleanup();
  __resetFailuresForTest();
});

describe('失败告警本体', () => {
  it('reportFailure 之后界面上看得见，并且带 role="alert"（读屏能播）', () => {
    render(<FailureNotices />);
    expect(screen.queryByRole('alert')).toBeNull(); // 没事的时候不许占屏
    say('结束会话失败：EACCES');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('结束会话失败：EACCES');
  });

  it('同一条重复来只留一张卡，次数如实加上', () => {
    render(<FailureNotices />);
    say('读取工作区信息失败：EPERM');
    say('读取工作区信息失败：EPERM');
    say('读取工作区信息失败：EPERM');
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain('3');
  });

  it('最多三张，第四张把最旧的挤掉（新的必须看得见，不许静默丢弃）', () => {
    render(<FailureNotices />);
    for (const t of ['第一处失败', '第二处失败', '第三处失败', '第四处失败']) say(t);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(3);
    const allText = alerts.map((a) => a.textContent ?? '').join('');
    expect(allText).toContain('第四处失败');
    expect(allText).not.toContain('第一处失败');
  });

  it('点 × 只关掉那一条，其它留着', () => {
    render(<FailureNotices />);
    say('要关掉的这条');
    say('留下来的这条');
    const before = screen.getAllByRole('alert');
    expect(before).toHaveLength(2);
    fireEvent.click(before[0]?.querySelector('button') as Element);
    const after = screen.getAllByRole('alert');
    expect(after).toHaveLength(1);
    expect(after[0]?.textContent).toContain('留下来的这条');
  });
});

describe('unhandledrejection 兜底', () => {
  it('没人接的拒绝会被说出来，并且说清"这一处没有 catch"', () => {
    const off = installFailureReporter();
    render(<FailureNotices />);
    reject(new Error('翻页失败：connection reset'));
    expect(screen.getByRole('alert').textContent).toContain('翻页失败：connection reset');
    expect(screen.getByRole('alert').textContent).toContain('没有地方接住');
    off();
  });

  it('拒绝原因不是 Error 也要说话（字符串 / undefined 都不能变成静默）', () => {
    const off = installFailureReporter();
    render(<FailureNotices />);
    reject('一个字符串原因');
    expect(screen.getByRole('alert').textContent).toContain('一个字符串原因');
    reject(undefined);
    // 两条都要在（第二条说"未知原因"），而不是把第一条悄悄换掉
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[1]?.textContent).toContain('未知原因');
    off();
  });

  it('cleanup 之后不再收（漏了这一步，热更新会叠出第二个监听器）', () => {
    const off = installFailureReporter();
    render(<FailureNotices />);
    reject(new Error('第一遍'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('第一遍');
    off();
    reject(new Error('第二遍'));
    // 还是那一张"第一遍"：既没有新卡，也没有把旧卡换掉
    const after = screen.getAllByRole('alert');
    expect(after).toHaveLength(1);
    expect(after[0]?.textContent).toContain('第一遍');
    expect(after[0]?.textContent).not.toContain('第二遍');
  });

  // 装配两处（main.tsx 装监听、App 挂组件）的**源码接线锁**在 `wiring-r22.test.ts`。
  // 不在这里写：那是扫源码的判据，必须跑在 node 环境 —— jsdom 下 `import.meta.url` 是 http 方案，
  // `readFileSync(new URL(...))` 会直接报 "The URL must be of scheme file"（2026-10-14 首跑实撞）。
});
