// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ToolCard } from './ToolCard';

/**
 * 工具卡的**实时输出**那一格（R8.7 · M4 收尾其三）。
 *
 * 为什么用组件测试而不是源码扫描：本轮要证明的是"长命令跑的时候，人看得见它在吐什么"，
 * 这是一句关于渲染结果的话 —— 扫源码只能证明"写了这行"，不能证明"显示出来了"。
 */

afterEach(() => {
  cleanup();
});

describe('ToolCard · 实时输出尾部', () => {
  it('命令还在跑：快照直接显示在卡片上，并说清"仍在运行"', () => {
    render(
      <ToolCard
        data={{ callId: 'c1', name: 'run_command', phase: 'running', argumentsText: '{}', tail: 'npm http fetch GET 200\n' }}
      />,
    );
    const box = screen.getByLabelText(/实时输出/);
    expect(box.textContent).toContain('npm http fetch GET 200');
    expect(box.getAttribute('aria-label')).toContain('仍在运行');
  });

  it('还没有输出：那一格根本不渲染（不出现一行空标题假装"没有输出"）', () => {
    render(<ToolCard data={{ callId: 'c2', name: 'run_command', phase: 'running', argumentsText: '{}' }} />);
    expect(screen.queryByLabelText(/实时输出/)).toBeNull();
  });

  it('快照是空串时同样不渲染（空内容不是内容）', () => {
    render(<ToolCard data={{ callId: 'c3', name: 'run_command', phase: 'running', argumentsText: '{}', tail: '' }} />);
    expect(screen.queryByLabelText(/实时输出/)).toBeNull();
  });

  it('命令已结束后保留最后一段，但话说成"末尾片段"（不再承诺还在跑）', () => {
    render(
      <ToolCard
        data={{
          callId: 'c4',
          name: 'run_command',
          phase: 'done',
          ok: true,
          argumentsText: '{}',
          summary: '退出码 0',
          tail: '最后一屏',
        }}
      />,
    );
    const box = screen.getByLabelText(/实时输出/);
    expect(box.textContent).toBe('最后一屏');
    expect(box.getAttribute('aria-label')).toBe('实时输出（末尾片段）');
  });
});
