/**
 * `killProcessTree` 的专测（R33 零专测补齐）。
 *
 * 为什么这个模块值得单独钉：它存在的**唯一理由**是"只杀父进程会留下孙进程继续跑"
 * （MCP 服务端与钩子常是 `cmd.exe /c npx …` 的三层结构，本项目实测过）。
 * 此前它只被 exec-tool / hooks / mcp 的真实子进程用例**间接**经过 —— 有路径、没靶子：
 * 把 `/T` 摘掉，那三处调用点的测试照样全绿（R33 探针 P311 实测），
 * 而症状是"关掉应用之后后台还有一个 node 在跑"，这种账最难靠人发现。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { KILL_GRACE_MS, killProcessTree, type KillableChild, type KillTreeDeps } from './process';

interface Harness {
  child: KillableChild;
  kills: string[];
  spawns: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }>;
  deps: KillTreeDeps;
  debugs: string[];
}

const make = (
  over: { pid?: number | undefined; exitCode?: number | null; signalCode?: string | null } = {},
  spawnFails = false,
): Harness => {
  const kills: string[] = [];
  const spawns: Harness['spawns'] = [];
  const debugs: string[] = [];
  const child: KillableChild = {
    ...over,
    kill: (signal?: string): boolean => {
      kills.push(signal ?? 'SIGTERM');
      return true;
    },
  };
  return {
    child,
    kills,
    spawns,
    debugs,
    deps: {
      spawn: (file, args, options) => {
        spawns.push({ file, args, options });
        if (spawnFails) throw new Error('taskkill 起不来');
        return {};
      },
      debug: (m) => debugs.push(m),
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('killProcessTree：Windows 走 taskkill /T', () => {
  it('带 pid 时只发 taskkill，参数里有 /T 与 /F 和那个 pid', () => {
    const h = make({ pid: 4321 });
    killProcessTree(h.child, { ...h.deps, platform: 'win32' });

    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0]?.file).toBe('taskkill');
    expect(h.spawns[0]?.args).toEqual(['/pid', '4321', '/T', '/F']);
    // 子进程不许被"自己 kill"绕过 —— 那正是留下孙进程的那条路
    expect(h.kills).toEqual([]);
  });

  it('/T 不许丢（丢了就是只杀父、孙进程继续跑）', () => {
    const h = make({ pid: 99 });
    killProcessTree(h.child, { ...h.deps, platform: 'win32' });
    expect(h.spawns[0]?.args).toContain('/T');
  });

  it('taskkill 起不来时回退到直接 SIGTERM，并把原因说出来', () => {
    const h = make({ pid: 7 }, true);
    vi.useFakeTimers();
    killProcessTree(h.child, { ...h.deps, platform: 'win32' });

    expect(h.kills).toEqual(['SIGTERM']);
    expect(h.debugs.some((m) => m.includes('taskkill 起不来'))).toBe(true);
  });

  it('没有 pid（spawn 还没成）时不许拿 undefined 去发 taskkill', () => {
    const h = make({});
    vi.useFakeTimers();
    killProcessTree(h.child, { ...h.deps, platform: 'win32' });
    expect(h.spawns).toEqual([]);
    expect(h.kills).toEqual(['SIGTERM']);
  });
});

describe('killProcessTree：非 Windows 先 TERM 后 KILL', () => {
  it('立刻 SIGTERM，宽限期到才 SIGKILL', () => {
    const h = make({ pid: 1234 });
    vi.useFakeTimers();
    killProcessTree(h.child, { ...h.deps, platform: 'linux' });

    expect(h.kills).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(KILL_GRACE_MS - 1);
    expect(h.kills).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(1);
    expect(h.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('宽限期内进程自己退了：SIGKILL 那次抛错要被吞掉，不炸调用方', () => {
    const h = make({ pid: 5 });
    vi.useFakeTimers();
    h.child.kill = (signal?: string): boolean => {
      const s = signal ?? 'SIGTERM';
      h.kills.push(s);
      if (s === 'SIGKILL') throw new Error('No such process');
      return true;
    };
    expect(() => killProcessTree(h.child, { ...h.deps, platform: 'darwin' })).not.toThrow();
    vi.advanceTimersByTime(KILL_GRACE_MS);
    expect(h.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('killProcessTree：已经死了就别再动它', () => {
  it('exitCode 已有值 → 一个信号都不发（pid 会被系统复用，误杀别人）', () => {
    const h = make({ pid: 4242, exitCode: 0 });
    killProcessTree(h.child, { ...h.deps, platform: 'win32' });
    expect(h.spawns).toEqual([]);
    expect(h.kills).toEqual([]);
  });

  it('signalCode 已有值（被信号结束）→ 同样什么都不做', () => {
    const h = make({ pid: 4242, signalCode: 'SIGKILL' });
    vi.useFakeTimers();
    killProcessTree(h.child, { ...h.deps, platform: 'linux' });
    expect(h.kills).toEqual([]);
    vi.advanceTimersByTime(KILL_GRACE_MS + 10);
    expect(h.kills).toEqual([]);
  });
});
