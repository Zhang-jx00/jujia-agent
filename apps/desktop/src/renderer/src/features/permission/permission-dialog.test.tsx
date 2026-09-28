// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PermissionRequestPayload } from '@jujia/shared-ipc';
import { PermissionDialog } from './PermissionDialog';

/**
 * 审批弹窗的**组件级**断言（2026-09-27 批复：首批组件测试 = 错误边界 + 安全相关弹窗）。
 *
 * 为什么这个组件值得单独测：全应用的"每一次副作用都要人点头"最后都收敛到这一个弹窗上。
 * 它一旦看不见内容、或者把"排队"变成"批量"，所有下游的分级判定就都白做了 ——
 * 而这些恰恰是纯函数与接线锁问不到的。
 */

const listeners = new Set<(req: PermissionRequestPayload) => void>();
const resolve = vi.fn();

function push(over: Partial<PermissionRequestPayload> = {}): void {
  const req = {
    id: 'perm-1',
    toolName: 'run_command',
    kind: 'exec' as const,
    summary: 'run_command · 执行命令：echo hi —— 执行命令，需确认',
    args: { command: 'echo hi' },
    paths: ['D:/work/demo'],
    ...over,
  } as PermissionRequestPayload;
  // 主进程推送是"外面来的"：必须包在 act 里，React 才会把这次 setState 冲刷完
  act(() => {
    for (const l of listeners) l(req);
  });
}

beforeEach(() => {
  listeners.clear();
  resolve.mockReset();
  vi.stubGlobal('jujia', {
    onPermissionRequest(listener: (req: PermissionRequestPayload) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    permissionResolve: resolve,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('审批弹窗：内容看得见、决定传得出去', () => {
  it('请求进来才出现，没请求时什么都不渲染（不是一张空卡）', () => {
    const { container } = render(<PermissionDialog />);
    expect(container.innerHTML).toBe('');
    push();
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('标题带完整摘要：工具名与命令行本身都要在（看不到内容的审批等于没审批）', () => {
    render(<PermissionDialog />);
    push();
    const title = screen.getByRole('heading', { level: 3 }).textContent ?? '';
    expect(title).toContain('run_command · 执行命令：echo hi');
    expect(title).toContain('执行命令，需确认'); // 策略层给的理由也送到人眼前
    expect(screen.getByText('工具', { exact: false }).textContent).toContain('run_command');
  });

  it('涉及路径单独列出来；完整参数能展开看到原文', () => {
    render(<PermissionDialog />);
    push();
    expect(screen.getByText('涉及路径：', { exact: false }).textContent).toContain('D:/work/demo');
    fireEvent.click(screen.getByText('查看完整参数'));
    // 只认参数块里那份（标题里也有 echo hi，宽正则会撞成多个元素）
    expect(screen.getByText(/"command"/).textContent).toContain('echo hi');
  });

  // 回填决定是**异步**的（弹窗里 await window.jujia.permissionResolve），
  // 所以这几条都要等一拍再问 —— 问的是"到底传没传出去"，不是"点没点中"。
  it('「拒绝」把 deny 原样回填；「允许一次」回填 allow_once', async () => {
    render(<PermissionDialog />);
    push();
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('perm-1', 'deny', undefined));
    resolve.mockClear();
    push({ id: 'perm-2' });
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('perm-2', 'allow_once', undefined));
  });

  it('改参数：合法 JSON 才提交，非法 JSON 就地报错且**不打扰主进程**', async () => {
    render(<PermissionDialog />);
    push();
    fireEvent.click(screen.getByRole('button', { name: '允许并修改参数…' }));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: '{ "command": ' } });
    fireEvent.click(screen.getByRole('button', { name: '按修改执行' }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByText(/JSON 不合法/)).not.toBeNull();

    fireEvent.change(box, { target: { value: '{ "command": "echo safe" }' } });
    fireEvent.click(screen.getByRole('button', { name: '按修改执行' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('perm-1', 'edit', { command: 'echo safe' }));
  });

  it('多个请求串行展示（一次只点一个），并如实报"还有几个在排队"', async () => {
    render(<PermissionDialog />);
    push({ id: 'perm-1', summary: '第一条摘要' });
    push({ id: 'perm-2', summary: '第二条摘要' });
    expect(screen.getByText(/还有 1 个请求在排队/)).not.toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('第一条摘要');
    // 队列前进也在异步那一拍之后：等它，再问"现在显示的是第二条"（不存在"批量确认"）
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('第二条摘要'),
    );
    expect(screen.queryByText(/还有 \\d+ 个请求在排队/)).toBeNull();
  });

  it('超时与拒绝是两件事：界面上说清"不响应按超时处理"', () => {
    render(<PermissionDialog />);
    push();
    expect(screen.getByText(/超时/).textContent).toContain('与主动拒绝区分');
  });

  it('不把默认焦点放在任何"允许"按钮上（防惯性回车）', () => {
    render(<PermissionDialog />);
    push();
    const active = document.activeElement;
    const isAllowButton =
      active !== null && active.tagName === 'BUTTON' && (active.textContent ?? '').includes('允许');
    // 没设焦点时 activeElement 是 body —— 那正是我们要的：默认不落在任何"允许"上
    expect(isAllowButton).toBe(false);
  });
});
