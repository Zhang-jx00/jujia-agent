import { describe, expect, it, vi } from 'vitest';
import { createUpdateService } from './update-service';

/**
 * 更新检查（M12 批二 · R11）。
 *
 * 无依赖最小形态：**查一次、说一句、指条路** —— 不下载、不执行、不改任何东西。
 * 所有失败路径都要说话（静默失败是头号禁区）：HTTP 404 要区分"查不到"与"真的网络断了"，
 * 版本号解析不动要明说，超时要有上界。
 */

const API = 'https://example.test/releases/latest';

function svc(fetchImpl: typeof fetch, current = '0.74.0'): ReturnType<typeof createUpdateService> {
  return createUpdateService({ currentVersion: current, fetchImpl, apiUrl: API });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createUpdateService.check', () => {
  it('有新版本：ok + latest + hasUpdate + 发布页地址都带回来', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ tag_name: 'v0.75.0', html_url: 'https://example.test/releases/tag/v0.75.0' }),
    );
    const r = await svc(fetchImpl).check();
    expect(r.ok).toBe(true);
    expect(r.current).toBe('0.74.0');
    expect(r.latest).toBe('v0.75.0');
    expect(r.hasUpdate).toBe(true);
    expect(r.url).toContain('releases/tag/v0.75.0');
    expect(r.error).toBe('');
  });

  it('已是最新：ok 但没有"新版本"（相同版本不狼来了）', async () => {
    const r = await svc(async () => jsonResponse({ tag_name: '0.74.0', html_url: 'x' })).check();
    expect(r.ok).toBe(true);
    expect(r.hasUpdate).toBe(false);
  });

  it('HTTP 404：直说"查不到"（仓库尚未公开 / 还没有发布都在这一档），不许装成失败以外的样子', async () => {
    const r = await svc(async () => jsonResponse({ message: 'Not Found' }, 404)).check();
    expect(r.ok).toBe(false);
    expect(r.hasUpdate).toBe(false);
    expect(r.error).toContain('404');
    expect(r.error).toContain('尚未公开');
  });

  it('网络抛错：把原因带出来（不吞）', async () => {
    const r = await svc(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    }).check();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ENOTFOUND');
  });

  it('版本号解析不动（如 nightly）：明说"读不懂版本号"，而不是默认没有新版本', async () => {
    const r = await svc(async () => jsonResponse({ tag_name: 'nightly', html_url: 'x' })).check();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('版本号');
  });

  it('超时：有上界、而且超时那句话说得出来', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const r = await createUpdateService({
      currentVersion: '0.74.0',
      fetchImpl,
      apiUrl: API,
      timeoutMs: 30,
    }).check();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('超时');
  });
});
