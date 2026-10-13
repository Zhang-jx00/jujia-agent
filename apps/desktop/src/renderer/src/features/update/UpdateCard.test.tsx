// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UpdateCheckResultView } from '@jujia/shared-ipc';
import { UpdateCard } from './UpdateCard';

/**
 * 更新卡的组件级断言（M12 批二 · R11）。
 *
 * 这里问的是三件界面级事实：**挂载时不许出站**（没有 useEffect 自动检查）、
 * **三种结局三种话**（有新版本 / 已最新 / 查不到，绝不许把查不到画成已最新）、
 * **打开走既有三档**（系统默认浏览器那一档照旧过人手）。
 */

function result(over: Partial<UpdateCheckResultView> = {}): UpdateCheckResultView {
  return { ok: true, current: '0.75.0', latest: '0.75.0', hasUpdate: false, url: '', error: '', ...over };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UpdateCard', () => {
  it('挂载时不发任何请求（没人点就不出站）；点一下才查一次', async () => {
    const updateCheck = vi.fn(async () => result());
    vi.stubGlobal('jujia', { updateCheck, browserOpenWith: vi.fn() });

    render(<UpdateCard currentVersion="0.75.0" />);
    expect(screen.getByText('v0.75.0')).toBeTruthy();
    expect(updateCheck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => {
      expect(updateCheck).toHaveBeenCalledTimes(1);
    });
  });

  it('有新版本：说清楚"有新版本"并且给出发布页入口（但绝不自动下载）', async () => {
    vi.stubGlobal('jujia', {
      updateCheck: vi.fn(async () =>
        result({ latest: 'v0.99.0', hasUpdate: true, url: 'https://example.test/releases/tag/v0.99.0' }),
      ),
      browserOpenWith: vi.fn(),
    });
    render(<UpdateCard currentVersion="0.75.0" />);
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText(/有新版本 v0\.99\.0/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开发布页' })).toBeTruthy();
  });

  it('查不到：显示"暂时查不到 + 原因"，绝不许画成"已是最新"', async () => {
    vi.stubGlobal('jujia', {
      updateCheck: vi.fn(async () => result({ ok: false, error: '查不到最新发布（HTTP 404 —— 仓库可能尚未公开、或还没有发布过）' })),
      browserOpenWith: vi.fn(),
    });
    render(<UpdateCard currentVersion="0.75.0" />);
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText(/暂时查不到：查不到最新发布/)).toBeTruthy();
    expect(screen.queryByText(/已是最新/)).toBeNull();
  });

  it('IPC 直接抛错也要变成一句人话（不许把异常吞成空白）', async () => {
    vi.stubGlobal('jujia', {
      updateCheck: vi.fn(async () => {
        throw new Error('IPC 断了');
      }),
      browserOpenWith: vi.fn(),
    });
    render(<UpdateCard currentVersion="0.75.0" />);
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText(/暂时查不到：IPC 断了/)).toBeTruthy();
  });

  it('打开发布页走系统默认浏览器那一档；被拒时把理由显示出来', async () => {
    const browserOpenWith = vi.fn(async () => ({
      ok: false,
      target: 'system' as const,
      asked: true,
      decision: 'deny',
      state: null,
      error: '你拒绝了这次打开',
    }));
    vi.stubGlobal('jujia', {
      updateCheck: vi.fn(async () => result({ hasUpdate: true, url: 'https://example.test/r' })),
      browserOpenWith,
    });
    render(<UpdateCard currentVersion="0.75.0" />);
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开发布页' }));
    await waitFor(() => {
      expect(browserOpenWith).toHaveBeenCalledWith('https://example.test/r', 'system');
      expect(screen.getByText(/没能打开：你拒绝了这次打开/)).toBeTruthy();
    });
  });
});
