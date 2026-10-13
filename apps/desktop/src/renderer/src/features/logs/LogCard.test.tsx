// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LogPageView } from '@jujia/shared-ipc';
import { LogCard } from './LogCard';

/**
 * 运行日志卡的**组件级**断言（M12 批一 · R10）。
 *
 * 为什么是组件测试而不是源码扫描：这张卡存在的意义就是"出了事之后看得见" ——
 * 它自己读不到、装没事、或者把主进程数好的账再算错，都只有把界面真渲染出来才看得见。
 */

function page(over: Partial<LogPageView> = {}): LogPageView {
  return {
    records: [],
    total: 0,
    unparsed: 0,
    dropped: 0,
    notice: '',
    file: 'D:/data/logs/app-2026-10-13.jsonl',
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LogCard', () => {
  it('把今天的记录渲染出来：时间 / 级别 / 来源 / 正文，文件路径与总数都在', async () => {
    const logsTail = vi.fn(async () =>
      page({
        records: [
          { ts: '2026-10-13T09:00:00.000Z', level: 'info', scope: 'app', msg: '启动' },
          { ts: '2026-10-13T09:01:00.000Z', level: 'warn', scope: 'schedule', msg: '规则坏了' },
        ],
        total: 2,
      }),
    );
    vi.stubGlobal('jujia', { logsTail, logsReveal: vi.fn() });

    render(<LogCard />);
    expect(await screen.findByText('启动')).toBeTruthy();
    expect(screen.getByText('规则坏了')).toBeTruthy();
    expect(screen.getByText('信息')).toBeTruthy();
    expect(screen.getByText('警告')).toBeTruthy();
    expect(screen.getByText(/app-2026-10-13\.jsonl/)).toBeTruthy();
    expect(screen.getByText(/2 条/)).toBeTruthy();
  });

  it('有异常（写失败/到上限）时那句话必须显示出来', async () => {
    vi.stubGlobal('jujia', {
      logsTail: vi.fn(async () => page({ total: 3, dropped: 2, notice: '今天已到上限，另有 2 条未记（本次运行计数）' })),
      logsReveal: vi.fn(),
    });
    render(<LogCard />);
    expect(await screen.findByText(/另有 2 条未记/)).toBeTruthy();
  });

  it('读不到日志就说出来（这张卡自己更不许装没事）', async () => {
    vi.stubGlobal('jujia', {
      logsTail: vi.fn(async () => {
        throw new Error('IPC 断了');
      }),
      logsReveal: vi.fn(),
    });
    render(<LogCard />);
    expect(await screen.findByText(/读不到日志：IPC 断了/)).toBeTruthy();
  });

  it('切到"警告以上"：再拉一次带 minLevel，空结果有对应文案', async () => {
    const logsTail = vi
      .fn()
      .mockResolvedValueOnce(page({ total: 1, records: [{ ts: '2026-10-13T09:00:00.000Z', level: 'info', scope: 'app', msg: '启动' }] }))
      .mockResolvedValueOnce(page({ total: 1, records: [] }));
    vi.stubGlobal('jujia', { logsTail, logsReveal: vi.fn() });

    render(<LogCard />);
    await screen.findByText('启动');
    fireEvent.change(screen.getByLabelText('日志级别过滤'), { target: { value: 'warn' } });
    expect(await screen.findByText('今天没有达到这个级别的记录。')).toBeTruthy();
    expect(logsTail).toHaveBeenLastCalledWith(50, 'warn');
  });

  it('"在文件夹中显示"：成功说成功、失败说失败（主进程答什么就显示什么）', async () => {
    const logsReveal = vi.fn(async () => ({ ok: false, error: '没有可用窗口' }));
    vi.stubGlobal('jujia', { logsTail: vi.fn(async () => page()), logsReveal });

    render(<LogCard />);
    fireEvent.click(await screen.findByRole('button', { name: '在文件夹中显示' }));
    await waitFor(() => {
      expect(screen.getByText(/没能定位：没有可用窗口/)).toBeTruthy();
    });
  });
});
