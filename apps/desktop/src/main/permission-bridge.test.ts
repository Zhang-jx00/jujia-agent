import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC, type PermissionExpiredPayload } from '@jujia/shared-ipc';
import { PermissionBridge, type PermissionBridgeDeps } from './permission-bridge';
import type { PermissionRequest } from '@jujia/agent-core';

/**
 * 权限审批桥的收尾语义（外部审查 T9）。
 *
 * 这一层唯一要紧的事：**主进程不再等的时候，必须让渲染层知道"哪一张卡可以关掉了"**。
 * 少了它，主进程按超时继续走，弹窗还挂着 —— 用户之后点"允许"是点到空气上，
 * 而界面上没有任何一处说"这一步没执行"。那是最坏的一种静默失败：
 * 它骗的不是程序，是正在做决定的人。
 */

const req = (id: string, over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id,
  toolName: 'write_file',
  kind: 'write',
  summary: '写入 a.txt',
  args: { path: 'a.txt' },
  paths: ['a.txt'],
  bypassable: true,
  ...over,
});

function harness(timeoutMs = 40): {
  bridge: PermissionBridge;
  expired: { channel: string; payload: unknown }[];
} {
  const expired: { channel: string; payload: unknown }[] = [];
  const deps: PermissionBridgeDeps = {
    send: (channel, payload) => {
      expired.push({ channel, payload });
      return true;
    },
    timeoutMs,
  };
  return { bridge: new PermissionBridge({ send: deps.send, timeoutMs }), expired };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('超时收尾', () => {
  it('等待超时后按"未响应"继续走，并且通知渲染层关掉这一张', async () => {
    const { bridge, expired } = harness(40);
    const p = bridge.resolve(req('perm-1'));
    await wait(120);
    await expect(p).resolves.toBe('timeout');
    const notice = expired.find((e) => e.channel === IPC.PERMISSION_EXPIRED);
    expect(notice?.payload).toMatchObject({ id: 'perm-1', reason: 'timeout' });
  });

  it('两个请求错开在等：超时通知只点名那一个，另一张仍可正常决定', async () => {
    const { bridge, expired } = harness(60);
    const first = bridge.resolve(req('perm-1'));
    await wait(150); // 第一张已经超时
    await expect(first).resolves.toBe('timeout');

    const second = bridge.resolve(req('perm-2'));
    const ids = expired
      .filter((e) => e.channel === IPC.PERMISSION_EXPIRED)
      .map((e) => (e.payload as PermissionExpiredPayload).id);
    expect(ids).toEqual(['perm-1']); // 通知里带 id，不是"全部关掉"
    // 第二张还挂着：能正常回填，说明它没被上一条通知顺手抹掉
    expect(bridge.settle('perm-2', 'deny')).toBe(true);
    await expect(second).resolves.toBe('deny');
    await wait(150);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('窗口销毁：每个还在等的请求各收到一条 window-closed，不静默挂起', async () => {
    const { bridge, expired } = harness(5_000);
    const p = bridge.resolve(req('perm-9'));
    bridge.cancelAll('窗口已关闭');
    await expect(p).resolves.toBe('timeout');
    const notices = expired.filter((e) => e.channel === IPC.PERMISSION_EXPIRED);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.payload).toMatchObject({ id: 'perm-9', reason: 'window-closed' });
  });
});

describe('回填的返回值是可信信号', () => {
  it('未知 id 返回 false —— 弹窗据此告诉用户"刚才的决定没有生效"', () => {
    const { bridge } = harness();
    expect(bridge.settle('never-existed', 'allow_once')).toBe(false);
  });

  it('已经结束的请求不能被二次回填（返回 false，不会二次放行）', async () => {
    const { bridge } = harness(40);
    const p = bridge.resolve(req('perm-3'));
    await wait(120);
    await expect(p).resolves.toBe('timeout');
    expect(bridge.settle('perm-3', 'allow_once')).toBe(false);
  });
});

describe('等待上界可以按环境调（运维参数，同时让超时这条路径真的能被验证）', () => {
  it('非法或过小的值不生效，仍走 120 秒默认', () => {
    vi.stubEnv('JJ_PERMISSION_TIMEOUT_MS', '10');
    const bridge = new PermissionBridge({ send: () => true });
    const p = bridge.resolve(req('perm-4'));
    // 立刻回填仍然命中：说明它没被那个非法值提前掐掉
    expect(bridge.settle('perm-4', 'allow_once')).toBe(true);
    return expect(p).resolves.toBe('allow_once');
  });

  it('合法值生效：注入 1.2 秒后确实按超时收尾', async () => {
    vi.stubEnv('JJ_PERMISSION_TIMEOUT_MS', '1200');
    const bridge = new PermissionBridge({ send: () => true });
    const started = Date.now();
    const p = bridge.resolve(req('perm-5'));
    await expect(p).resolves.toBe('timeout');
    // 真的按注入值走（而不是 120 秒默认），也真的没提前到把正常审批变成不可完成
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
