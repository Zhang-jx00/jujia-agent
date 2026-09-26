import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserExeClearSchema } from '@jujia/shared-ipc';
import type { PermissionDecision, PermissionMode, PermissionRequest, PermissionRule } from '@jujia/agent-core';
import { checkExePath, createOpenWithService, type ExePathStore, type OpenWithPolicy } from './open-with-service';

/**
 * 「打开方式」服务层的验收（M10 收尾）。
 *
 * 判档对不对，`open-with-gate.test.ts` 已经钉死了；这里盯的是**流程**：
 *  - 问过之后才交出去；没问过 = 一次都没交出去（看假启动器的调用记录，不看界面文案）；
 *  - 「总是允许」压不掉第二次询问（这是"外发动作没有记住这条路"的机器化证明）；
 *  - 畸形网址与不合规的自选程序在**弹窗之前**就被拦下 —— 不能让用户的点击替它们背书；
 *  - 启动失败要说成一句可读的理由，不能变成"点了没反应"。
 *
 * 两个假启动器（`openInSystemBrowser` / `launchProgram`）是这一层的全部外部世界：
 * 真的 `shell.openExternal` 与 `spawn` 由 `open-with-launch.ts` 承担，
 * 界面级 e2e 用本机自带的命令行工具走一次真链路拿磁盘/网络真值。
 */

const rule = (pattern: string, action: 'allow' | 'deny' | 'ask'): PermissionRule => ({
  id: `r-${pattern}-${action}`,
  pattern,
  action,
  enabled: true,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
});

let workspaceRoot = '';
let outsideDir = '';

/** 整套用例共用一份临时目录（每个用例都 mkdtemp 会留下几十个没人收的目录） */
let ready: Promise<void> | null = null;

function setup(): Promise<void> {
  ready ??= (async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'jujia-ows-ws-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'jujia-ows-bin-'));
    // 一个"真的存在的文件"当自选程序：服务层只查存在性，不启动它（启动器是假的）
    await writeFile(join(workspaceRoot, 'repo-browser.exe'), 'not-a-real-exe', 'utf8');
    await writeFile(join(outsideDir, 'fake-browser.exe'), 'not-a-real-exe', 'utf8');
    await writeFile(join(outsideDir, 'launcher.cmd'), '@echo off', 'utf8');
  })();
  return ready;
}

interface Harness {
  service: ReturnType<typeof createOpenWithService>;
  dialogs: PermissionRequest[];
  launched: string[];
  setAnswer: (a: PermissionDecision) => void;
  setExe: (p: string | null) => void;
}

function makeHarness(over: Partial<OpenWithPolicy> = {}): Harness {
  const dialogs: PermissionRequest[] = [];
  const launched: string[] = [];
  let answer: PermissionDecision = 'allow_once';
  let storedExe: string | null = null;
  const store: ExePathStore = {
    read: async () => storedExe,
    write: async (v) => {
      storedExe = v;
    },
  };
  const policy: OpenWithPolicy = {
    mode: over.mode ?? 'default',
    rules: over.rules ?? [],
    alwaysAsk: over.alwaysAsk ?? [],
  };
  const service = createOpenWithService({
    loadPolicy: async () => policy,
    resolvePermission: (req) => {
      dialogs.push(req);
      return Promise.resolve(answer);
    },
    getWorkspaceRoot: async () => workspaceRoot,
    openInSystemBrowser: async (url) => {
      launched.push(`system|${url}`);
    },
    launchProgram: async (exePath, url) => {
      launched.push(`exe|${exePath}|${url}`);
    },
    exeStore: store,
  });
  return {
    service,
    dialogs,
    launched,
    setAnswer: (a) => {
      answer = a;
    },
    setExe: (p) => {
      storedExe = p;
    },
  };
}

describe('内置那一档：不惊动人，也不碰外部世界', () => {
  it('internal 不过权限门、不调用任何启动器', async () => {
    await setup();
    const h = makeHarness();
    const r = await h.service.openWith('internal', 'https://example.com');
    expect(r.ok).toBe(true);
    expect(h.dialogs.length).toBe(0);
    expect(h.launched.length).toBe(0);
  });
});

describe('外部两档：问过才交出去', () => {
  it('允许一次 → 恰好一次交付，且参数只有网址', async () => {
    await setup();
    const h = makeHarness();
    const r = await h.service.openWith('system', 'https://example.com/a');
    expect(r.ok).toBe(true);
    expect(h.dialogs.length).toBe(1);
    expect(h.launched).toEqual(['system|https://example.com/a']);
    // 弹窗上必须看得见"这是交给外部"，而不是笼统的"打开链接"
    expect(h.dialogs[0]?.summary).toContain('离开本应用的安全边界');
    expect(h.dialogs[0]?.kind).toBe('exec');
  });

  it('拒绝 → **一次都没交出去**（真值看假启动器的调用记录）', async () => {
    await setup();
    const h = makeHarness();
    h.setAnswer('deny');
    const r = await h.service.openWith('system', 'https://example.com/a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('未交给');
    expect(h.launched.length).toBe(0);
  });

  it('超时 → 同样不交出去，且理由与"你拒绝了"区分开', async () => {
    await setup();
    const h = makeHarness();
    h.setAnswer('timeout');
    const r = await h.service.openWith('system', 'https://example.com/a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('超时');
    expect(h.launched.length).toBe(0);
  });

  it('点了「本次会话总是允许」→ **第二次仍然问**（外发动作没有记住这条路）', async () => {
    await setup();
    const h = makeHarness();
    h.setAnswer('allow_always');
    const first = await h.service.openWith('system', 'https://example.com/one');
    const second = await h.service.openWith('system', 'https://example.com/two');
    expect(first.ok && second.ok).toBe(true);
    expect(h.dialogs.length).toBe(2);
    expect(h.launched.length).toBe(2);
  });

  it('换到自选程序那一档：交付时带上的是**选定那个文件**，不是别的', async () => {
    await setup();
    const h = makeHarness();
    h.setExe(join(outsideDir, 'fake-browser.exe'));
    const r = await h.service.openWith('custom', 'https://example.com/b');
    expect(r.ok).toBe(true);
    expect(h.launched).toEqual([`exe|${join(outsideDir, 'fake-browser.exe')}|https://example.com/b`]);
    // 复核 030 批复点名的那条：**完整路径**要摊在弹窗上，不是只给个文件名
    // （与 run_command 同一条原则：审批看不到内容，就等于没有审批）
    expect(h.dialogs[0]?.summary).toContain(join(outsideDir, 'fake-browser.exe'));
  });
});

describe('不该弹窗的输入，在弹窗之前就拦掉', () => {
  it.each([
    ['file:///C:/Windows/win.ini', '本地文件协议'],
    ['javascript:alert(1)', 'javascript'],
  ])('%s → 拒绝且不弹确认', async (url, needle) => {
    await setup();
    const h = makeHarness();
    const r = await h.service.openWith('system', url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain(needle.toLowerCase());
    expect(h.dialogs.length).toBe(0);
    expect(h.launched.length).toBe(0);
  });

  it('自选那一档还没选过程序 → 直接说清楚，不弹一个注定失败的确认', async () => {
    await setup();
    const h = makeHarness();
    const r = await h.service.openWith('custom', 'https://example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('还没有选定');
    expect(h.dialogs.length).toBe(0);
  });

  it('规则表写 open_with_* deny → 不问也不交（连 bypassPermissions 也让路）', async () => {
    await setup();
    const h = makeHarness({ mode: 'bypassPermissions', rules: [rule('open_with_*', 'deny')] });
    const r = await h.service.openWith('system', 'https://example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('权限策略拒绝');
    expect(h.dialogs.length).toBe(0);
    expect(h.launched.length).toBe(0);
  });

  it('allow 规则是显式写下来的决定 → 不打扰，但**照样交付**', async () => {
    await setup();
    const h = makeHarness({ rules: [rule('open_with_system', 'allow')] });
    const r = await h.service.openWith('system', 'https://example.com/c');
    expect(r.ok).toBe(true);
    expect(h.dialogs.length).toBe(0);
    expect(h.launched).toEqual(['system|https://example.com/c']);
  });
});

describe('checkExePath：一条规则对应一个"不拦会怎样"', () => {
  it('拒绝相对路径（会按进程工作目录解析，用户不知道启动了哪个文件）', async () => {
    await setup();
    const r = await checkExePath('browser.exe', null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('绝对路径');
  });

  it('拒绝工作区内的程序（仓库带一个 exe 就能被"打开网页"调起来）', async () => {
    await setup();
    const r = await checkExePath(join(workspaceRoot, 'repo-browser.exe'), workspaceRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('工作区');
  });

  it('Windows 上拒绝 .cmd / .bat（要启它必须拼命令行，注入面太大）', async () => {
    await setup();
    const r = await checkExePath(join(outsideDir, 'launcher.cmd'), null, 'win32');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('.cmd');
  });

  it('拒绝不存在的路径与目录', async () => {
    await setup();
    const missing = await checkExePath(join(outsideDir, 'nope.exe'), null);
    expect(missing.ok).toBe(false);
    const dir = await checkExePath(outsideDir, null);
    expect(dir.ok).toBe(false);
    if (!dir.ok) expect(dir.error).toContain('不是单个文件');
  });

  it('放过一个工作区外、真实存在的文件', async () => {
    await setup();
    const ok = await checkExePath(join(outsideDir, 'fake-browser.exe'), workspaceRoot);
    expect(ok.ok).toBe(true);
  });
});

describe('选定与清除自选程序', () => {
  it('acceptPickedExe 成功即落盘，可被读回', async () => {
    await setup();
    const h = makeHarness();
    const picked = join(outsideDir, 'fake-browser.exe');
    const r = await h.service.acceptPickedExe(picked);
    expect(r.ok).toBe(true);
    expect(await h.service.currentExePath()).toBe(picked);
  });

  it('对话框选中一个不合规的路径 → **不落盘**，原值保持不变', async () => {
    await setup();
    const h = makeHarness();
    const good = join(outsideDir, 'fake-browser.exe');
    await h.service.acceptPickedExe(good);
    const bad = await h.service.acceptPickedExe(join(workspaceRoot, 'repo-browser.exe'));
    expect(bad.ok).toBe(false);
    expect(await h.service.currentExePath()).toBe(good);
  });

  it('清除后回到"没有路径"', async () => {
    await setup();
    const h = makeHarness();
    await h.service.acceptPickedExe(join(outsideDir, 'fake-browser.exe'));
    await h.service.clearExePath();
    expect(await h.service.currentExePath()).toBe(null);
  });

  /**
   * 契约级防线：**界面拿不到"直接塞路径"的能力**。
   * 这条断言是变异 M18 的靶子 —— 把 `z.null()` 放宽成接受字符串，这里立刻红。
   */
  it('清除契约只收 null：带路径的请求一律解析失败', () => {
    expect(browserExeClearSchema.safeParse({ path: null }).success).toBe(true);
    expect(browserExeClearSchema.safeParse({ path: 'C:/windows/system32/curl.exe' }).success).toBe(false);
    expect(browserExeClearSchema.safeParse({}).success).toBe(false);
    expect(browserExeClearSchema.safeParse({ path: null, extra: 1 }).success).toBe(false);
  });
});

describe('交出去这一步真的失败了（不是"点了没反应"）', () => {
  it('启动器抛错 → 理由原样带回，且不会被算成"已打开"', async () => {
    await setup();
    // 覆盖成真会抛的实现：模拟"选完之后文件被人挪走了 / 系统没有关联程序"
    const service = createOpenWithService({
      loadPolicy: async () => ({ mode: 'default', rules: [], alwaysAsk: [] }),
      resolvePermission: () => Promise.resolve('allow_once' as PermissionDecision),
      getWorkspaceRoot: async () => workspaceRoot,
      openInSystemBrowser: async () => {
        throw new Error('没有关联的程序');
      },
      launchProgram: async () => undefined,
    });
    const r = await service.openWith('system', 'https://example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('没有关联的程序');
  });

  it('模式切到 acceptEdits 也不会多问出一次"免问"（该拦的仍然拦在前面）', async () => {
    await setup();
    const mode: PermissionMode = 'acceptEdits';
    const h = makeHarness({ mode });
    // custom 还没选过程序 → 静态校验先拦；选了也仍是 ask（判档那侧由 gate 用例钉住）
    await h.service.openWith('custom', 'https://example.com');
    expect(h.dialogs.length).toBe(0);
    expect(h.launched.length).toBe(0);
  });
});
