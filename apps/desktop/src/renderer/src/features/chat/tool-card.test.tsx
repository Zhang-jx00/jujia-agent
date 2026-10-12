// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

/**
 * 展开/收起（R18 · 优化5）：按 `docs/DESIGN-BASELINE.md` 的硬要求钉住四条 ——
 * ① 容器用**真实内容高度**的连续过渡（`grid-template-rows` 的 0fr↔1fr，不是猜一个 max-height）；
 * ② 箭头是**同一个元素旋转 180°**（不许"换一个字符"）；
 * ③ 内容**始终挂载**（重挂载 = 文字突然出现），收起时靠 `inert` + `aria-hidden` 退出可达性树；
 * ④ 收起也有另一端的过渡（两态都在 DOM 上可查）。
 */
describe('工具卡的展开/收起是连续过渡，不是瞬时切换', () => {
  const card = {
    callId: 'c9',
    name: 'read_file',
    phase: 'done' as const,
    ok: true,
    argumentsText: '{"path":"a"}',
  };

  it('收起态：内容已挂载但不可达（inert + aria-hidden），容器带 data-collapsed', () => {
    render(<ToolCard data={card} />);
    const wrap = document.querySelector('.jj-collapse');
    expect(wrap).not.toBeNull();
    expect(wrap?.getAttribute('data-collapsed')).toBe('true');
    const inner = wrap?.firstElementChild as HTMLElement | null;
    expect(inner?.getAttribute('aria-hidden')).toBe('true');
    expect(inner?.hasAttribute('inert')).toBe(true);
    expect(document.body.textContent).toContain('"path"'); // 内容确实挂着（展开时才有东西可过渡）
  });

  it('点开之后：同一容器翻到展开态，内容回到可达性树', () => {
    render(<ToolCard data={card} />);
    fireEvent.click(screen.getByRole('button', { name: /read_file/ }));
    const wrap = document.querySelector('.jj-collapse');
    expect(wrap?.getAttribute('data-collapsed')).toBe('false');
    const inner = wrap?.firstElementChild as HTMLElement | null;
    expect(inner?.getAttribute('aria-hidden')).not.toBe('true');
    expect(inner?.hasAttribute('inert')).toBe(false);
  });

  it('箭头是同一个元素旋转 180°：只有 data-open 在变，没有第二个字符', () => {
    render(<ToolCard data={card} />);
    const caret = document.querySelector('[data-caret]');
    expect(caret).not.toBeNull();
    expect(caret?.getAttribute('data-open')).toBe('false');
    const closedText = caret?.textContent;
    fireEvent.click(screen.getByRole('button', { name: /read_file/ }));
    const caret2 = document.querySelector('[data-caret]');
    expect(caret2?.getAttribute('data-open')).toBe('true');
    // 同一个字形：旋转交给 CSS，DOM 文本不许跟着换
    expect(caret2?.textContent).toBe(closedText);
  });

  it('再点一次收起（收起也有过渡的另一端）', () => {
    render(<ToolCard data={card} />);
    const l0 = screen.getByRole('button', { name: /read_file/ });
    fireEvent.click(l0);
    fireEvent.click(l0);
    expect(document.querySelector('.jj-collapse')?.getAttribute('data-collapsed')).toBe('true');
    expect(document.querySelector('[data-caret]')?.getAttribute('data-open')).toBe('false');
  });
});
