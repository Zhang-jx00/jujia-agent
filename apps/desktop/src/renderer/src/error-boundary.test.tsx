// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Component } from 'react';
import type { ReactElement } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * 错误边界的**组件级**验证（2026-09-27 批复加 jsdom + @testing-library）。
 *
 * 为什么非要真渲染：此前只有纯函数（卡上写什么）与接线锁（边界挂在哪一层），
 * 两者都问不到那一件唯一要紧的事 —— **"页面真的崩掉时，用户看得到那张卡，而不是白屏"**。
 * 这一条只能靠把组件真的渲染出来、真的让它抛、再看界面。
 */

let boom = false;
let mounts = 0;

function Panel(): ReactElement {
  mounts += 1;
  if (boom) throw new Error('JUJIA_BOOM 加载失败');
  return <div data-testid="panel">页面内容</div>;
}

/** React 会自己打印被边界接住的错误；这里保留它真实的调用记录，断言"不静默" */
let errored: unknown[] = [];

beforeEach(() => {
  boom = false;
  mounts = 0;
  errored = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errored.push(args);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary 真的接住渲染异常', () => {
  it('不抛时照常渲染子组件，不出卡', () => {
    render(
      <ErrorBoundary area="对话">
        <Panel />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('panel').textContent).toContain('页面内容');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('子组件抛了 → 显示错误卡，且点名是哪一页、带原始错误', () => {
    boom = true;
    render(
      <ErrorBoundary area="对话">
        <Panel />
      </ErrorBoundary>,
    );
    const card = screen.getByRole('alert');
    expect(card.textContent).toContain('「对话」这一页没能显示出来');
    expect(card.textContent).toContain('JUJIA_BOOM 加载失败');
    expect(card.textContent).toContain('重试');
  });

  it('不是静默失败：console.error 一定收到（界面给摘要，控制台留全量）', () => {
    boom = true;
    render(
      <ErrorBoundary area="浏览器">
        <Panel />
      </ErrorBoundary>,
    );
    // 看**全部**调用而不是第一条：React 自己会先打一份组件栈，我们的那条紧随其后。
    // 断言的是"边界确实把事发地点报出来了"，不是"谁先开口"。
    expect(errored.length).toBeGreaterThan(0);
    expect(JSON.stringify(errored)).toContain('浏览器');
  });

  it('点「重试」重新挂载子组件（不是只能刷新整个应用）', () => {
    boom = true;
    const view = render(
      <ErrorBoundary area="Git">
        <Panel />
      </ErrorBoundary>,
    );
    expect(mounts).toBeGreaterThanOrEqual(1); // 抛之前函数体已经跑过（React 重试时次数不固定）
    expect(screen.queryByTestId('panel')).toBeNull();

    boom = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(view.getByTestId('panel')).not.toBeNull();
    expect(mounts).toBeGreaterThan(1); // 子树被重新挂载；边界自己没被重建（否则 area 会换）
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('超长堆栈在界面上被截断，并告诉用户去哪儿看全量', () => {
    class Thrower extends Component {
      override render(): ReactElement {
        throw new Error('x'.repeat(900));
      }
    }
    render(
      <ErrorBoundary area="文档">
        <Thrower />
      </ErrorBoundary>,
    );
    const card = screen.getByRole('alert');
    expect((card.textContent ?? '').length).toBeLessThan(1_200);
    expect(card.textContent).toContain('开发者控制台');
  });
});
