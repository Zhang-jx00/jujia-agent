// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette, type CanvasCommand } from './CommandPalette';

/**
 * 命令面板的组件级断言（B1）。
 *
 * 它值得单测的理由：面板是"键盘也能开火"的入口 —— 过滤错了会执行**另一条命令**、
 * 空过滤还让 Enter 生效会成为"闭眼按回车"的隐患。这些恰是纯函数与 e2e 都不容易盯的：
 * e2e 只走一两条固定路径，纯函数管不到键盘与焦点。
 */

const runAdd = vi.fn();
const runSave = vi.fn();
const runRun = vi.fn();
const runFit = vi.fn();
const commands: CanvasCommand[] = [
  { id: 'add-prompt', label: '添加提示词节点', run: runAdd },
  { id: 'save', label: '保存这张图', run: runSave },
  { id: 'run', label: '运行这张图', run: runRun },
  // 带拉丁字母的一条：大小写不敏感只能靠它验（中文标签里没有大小写）
  { id: 'fit', label: 'FitView 适应视图', run: runFit },
];

afterEach(() => {
  cleanup();
  runAdd.mockReset();
  runSave.mockReset();
  runRun.mockReset();
  runFit.mockReset();
});

describe('CommandPalette', () => {
  it('关着的时候什么都不渲染', () => {
    const { container } = render(<CommandPalette open={false} commands={commands} onClose={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('打开后列出全部命令；输入过滤且大小写不敏感', () => {
    render(<CommandPalette open commands={commands} onClose={() => undefined} />);
    expect(screen.getByText('添加提示词节点')).toBeTruthy();
    expect(screen.getByText('保存这张图')).toBeTruthy();
    const input = screen.getByLabelText('命令');
    fireEvent.change(input, { target: { value: '保存' } });
    expect(screen.queryByText('添加提示词节点')).toBeNull();
    expect(screen.getByText('保存这张图')).toBeTruthy();
    // 大小写不敏感：小写查询命中大写标签
    fireEvent.change(input, { target: { value: 'fitview' } });
    expect(screen.getByText('FitView 适应视图')).toBeTruthy();
    expect(screen.queryByText('保存这张图')).toBeNull();
  });

  it('没有匹配时给出提示，且 Enter 既不执行也不关（不许"闭眼回车"落到别的命令上）', () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('命令'), { target: { value: 'zzzz-不存在' } });
    expect(screen.getByText('没有匹配的命令')).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('命令'), { key: 'Enter' });
    expect(runAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('默认 Enter 执行第一条；ArrowDown 之后执行的是**选中那条**', () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    const input = screen.getByLabelText('命令');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(runSave).toHaveBeenCalledTimes(1);
    expect(runAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击某条命令：执行它并关闭', () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    fireEvent.click(screen.getByText('运行这张图'));
    expect(runRun).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('重开时输入与选中复位；Esc 关闭但什么都不执行', () => {
    const onClose = vi.fn();
    const { rerender } = render(<CommandPalette open commands={commands} onClose={onClose} />);
    const input = screen.getByLabelText('命令') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '保存' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runSave).not.toHaveBeenCalled();
    rerender(<CommandPalette open={false} commands={commands} onClose={onClose} />);
    rerender(<CommandPalette open commands={commands} onClose={onClose} />);
    expect((screen.getByLabelText('命令') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('添加提示词节点')).toBeTruthy();
  });
});
