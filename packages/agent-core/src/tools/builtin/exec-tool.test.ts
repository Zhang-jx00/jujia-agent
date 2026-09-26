import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTool, type PermissionDecision, type PermissionRequest } from '../executor';
import { ToolError, type ToolContext } from '../types';
import { createDefaultRegistry } from '../registry';
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  MAX_EXEC_OUTPUT_BYTES,
  MAX_EXEC_TIMEOUT_MS,
  EXEC_TOOL_NAME,
  buildExecInvocation,
  capOutput,
  clampTimeout,
  execOnce,
  runCommandTool,
  type ExecChild,
  type ExecDeps,
} from './exec-tool';

/**
 * `run_command` 的验收（M4 / 铺设计划 8）。
 *
 * 这是本项目**第一个让模型自己动手**的能力，所以测试的重心不在"命令能不能跑出来"，
 * 而在四件"跑之前必须先成立"的事：
 *   ① 声明为执行类 → 权限引擎判硬 ask（`kind` 被改松就要红）；
 *   ② 工作目录越界 → 连 spawn 都不该被调用；
 *   ③ 子进程环境不含密钥类变量；
 *   ④ 用户拒绝 / 超时 → **磁盘上没有留下任何痕迹**。
 */

// 真实 spawn 的用例在本机单次约 0.7–1s（Windows + 安全软件扫描），给足时间避免偶发失败
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let root = '';
const ctx = (): ToolContext => ({ workspaceRoot: root });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-exec-tool-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/* ---------------- 可注入的假子进程 ---------------- */

interface FakeOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  /** true = 永远不退（用来触发超时） */
  hang?: boolean;
  env?: Record<string, unknown>;
  pid?: number | undefined;
}

function makeFake(opts: FakeOptions = {}) {
  const calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];
  let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
  let errorListener: ((err: Error) => void) | null = null;
  const dataListeners = { stdout: [] as ((c: unknown) => void)[], stderr: [] as ((c: unknown) => void)[] };
  let stdinEnded = false;
  let done = false;
  /**
   * 信号先于监听器到达时**先挂起**，等监听器就位再补发。
   * 为什么必须这样：`execOnce` 在 spawn 之前还要 await 两次 fs 操作，
   * 所以"spawn 之后立刻 finish"或"测试里马上 emitError"都会落在监听器之前，
   * 信号被丢掉 → 用例一路挂到超时（本轮实测踩过，整轮 122 秒全是这么挂的）。
   */
  let pendingFinish = false;
  let pendingError: Error | null = null;

  function emitData(): void {
    if (opts.stdout !== undefined) for (const cb of dataListeners.stdout) cb(Buffer.from(opts.stdout, 'utf8'));
    if (opts.stderr !== undefined) for (const cb of dataListeners.stderr) cb(Buffer.from(opts.stderr, 'utf8'));
  }

  function finishOnce(): void {
    if (done) return;
    if (exitListener === null) {
      pendingFinish = true;
      return;
    }
    done = true;
    emitData();
    exitListener(opts.exitCode ?? 0, null);
  }

  const child: ExecChild = {
    pid: opts.pid,
    stdout: { on: (ev, cb) => { if (ev === 'data') dataListeners.stdout.push(cb); } },
    stderr: { on: (ev, cb) => { if (ev === 'data') dataListeners.stderr.push(cb); } },
    stdin: {
      write: () => undefined,
      end: () => {
        stdinEnded = true;
      },
      on: () => undefined,
    },
    on: (ev, listener) => {
      if (ev === 'exit') {
        exitListener = listener as (c: number | null, s: string | null) => void;
        if (pendingFinish) finishOnce();
      }
      if (ev === 'error') {
        errorListener = listener as (e: Error) => void;
        if (pendingError !== null) {
          const e = pendingError;
          pendingError = null;
          errorListener(e);
        }
      }
    },
    kill: () => {
      // 超时杀树之后，真实子进程会回报退出；这里模拟"被杀掉"
      done = false;
      pendingFinish = false;
      if (exitListener !== null) {
        done = true;
        exitListener(null, 'SIGTERM');
      }
      return true;
    },
  };

  const deps: ExecDeps = {
    spawn: ((file, args, options) => {
      calls.push({ file, args, options });
      // 同一个假进程可能服务多次调用（"总是允许之后还问不问"就要跑两次）：
      // 每次 spawn 都要重置状态，否则第二次没有退出信号 → 一路挂到超时才"侥幸通过"（本轮实测 30 秒）
      done = false;
      pendingFinish = false;
      if (opts.hang !== true) setTimeout(finishOnce, 0);
      return child;
    }) as ExecDeps['spawn'],
    platform: 'win32',
    baseEnv: opts.env !== undefined ? (opts.env as Record<string, string | undefined>) : {},
  };

  return {
    deps,
    calls,
    finish: finishOnce,
    emitError: (e: Error): void => {
      if (errorListener === null) {
        pendingError = e;
        return;
      }
      errorListener(e);
    },
    get stdinEnded(): boolean {
      return stdinEnded;
    },
  };
}

/* ---------------- 纯函数：shell 选择与限额 ---------------- */

describe('shell 选择：回退必须是绝对路径', () => {
  it('Windows 优先用 ComSpec，并带 /d /c', () => {
    const r = buildExecInvocation('git status', 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
    expect(r.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(r.args).toEqual(['/d', '/c', 'git status']);
  });

  it('没有 ComSpec 时回退到 %SystemRoot%\\System32\\cmd.exe，**绝不返回裸名**（裸名会走 PATH 查找）', () => {
    const r = buildExecInvocation('dir', 'win32', { SystemRoot: 'D:\\Win' });
    expect(r.file).toBe(join('D:\\Win', 'System32', 'cmd.exe'));
    expect(r.file).toMatch(/[\\/]/);
  });

  it('POSIX 用 $SHELL + -c', () => {
    const r = buildExecInvocation('ls -la', 'linux', { SHELL: '/bin/zsh' });
    expect(r.file).toBe('/bin/zsh');
    expect(r.args).toEqual(['-c', 'ls -la']);
  });

  it('POSIX 没有 SHELL 时回退 /bin/bash', () => {
    expect(buildExecInvocation('ls', 'darwin', {}).file).toBe('/bin/bash');
  });
});

describe('超时与输出限额', () => {
  it('未给 / 非正 / 非有限 → 用默认值；过大 → 夹到上限', () => {
    expect(clampTimeout(undefined)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampTimeout(0)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampTimeout(-5)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampTimeout(Number.NaN)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampTimeout(99_999_999)).toBe(MAX_EXEC_TIMEOUT_MS);
  });

  it('未超限不动；超限按字节裁并如实标注', () => {
    expect(capOutput('hello', 10)).toEqual({ text: 'hello', truncated: false });
    const big = 'x'.repeat(24);
    const capped = capOutput(big, 10);
    expect(capped.truncated).toBe(true);
    expect(Buffer.byteLength(capped.text, 'utf8')).toBe(10);
  });

  it('中文按 UTF-8 **字节**算，不是按字符数', () => {
    const capped = capOutput('中中中中', 6);
    expect(capped.truncated).toBe(true);
    expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(6);
  });
});

/* ---------------- 工具声明本身是安全语义 ---------------- */

describe('工具声明', () => {
  it('kind 必须是 exec —— 这是"每次硬 ask、总是允许压不掉"的唯一依据', () => {
    expect(runCommandTool.kind).toBe('exec');
    expect(runCommandTool.name).toBe(EXEC_TOOL_NAME);
  });

  it('描述里写明了"每次都需要用户确认"与环境/超时约束（模型看得见的契约）', () => {
    expect(runCommandTool.description).toContain('每次执行都需要用户确认');
    expect(runCommandTool.description).toContain('工作目录必须在工作区内');
    expect(runCommandTool.description).toContain('不含密钥类变量');
  });

  it('参数：command 必填、不接受多余字段', () => {
    expect(runCommandTool.parameters.required).toEqual(['command']);
    expect(runCommandTool.parameters.additionalProperties).toBe(false);
  });

  it('parse 拒绝空命令 / 非字符串 / 多余字段，接受可选 cwd 与 timeoutMs', () => {
    expect(() => runCommandTool.parse({ command: '' })).toThrow();
    expect(() => runCommandTool.parse({})).toThrow();
    expect(() => runCommandTool.parse({ command: 123 })).toThrow();
    expect(() => runCommandTool.parse({ command: 'ls', extra: 'x' })).toThrow();
    expect(runCommandTool.parse({ command: 'ls' })).toEqual({ command: 'ls' });
    expect(runCommandTool.parse({ command: 'ls', cwd: 'sub', timeoutMs: 1000 })).toEqual({
      command: 'ls',
      cwd: 'sub',
      timeoutMs: 1000,
    });
  });
});

/* ---------------- 执行前后的边界 ---------------- */

describe('工作目录守卫：越界时连进程都不该启动', () => {
  it('cwd 指向工作区外 → path_denied，且 spawn 零调用', async () => {
    const fake = makeFake({ stdout: 'nope' });
    await expect(execOnce({ command: 'del C:\\Windows\\win.ini', cwd: '..' }, ctx(), fake.deps)).rejects.toThrow(
      ToolError,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it('cwd 不存在 → not_found，且 spawn 零调用', async () => {
    const fake = makeFake();
    await expect(execOnce({ command: 'dir', cwd: 'no-such-dir' }, ctx(), fake.deps)).rejects.toThrow(/工作目录不存在/);
    expect(fake.calls).toHaveLength(0);
  });

  it('cwd 指向文件而不是目录 → 同样拒绝', async () => {
    const f = join(root, 'afile.txt');
    await writeFile(f, 'x', 'utf8');
    const fake = makeFake();
    await expect(execOnce({ command: 'dir', cwd: 'afile.txt' }, ctx(), fake.deps)).rejects.toThrow(/不是目录/);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('子进程环境：密钥类变量一律不带', () => {
  it('剔除 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/AUTH 与 ELECTRON_RUN_AS_NODE，代理只脱敏', async () => {
    const fake = makeFake({
      env: {
        PATH: 'C:\\Windows',
        OPENAI_API_KEY: 'sk-secret',
        GITHUB_TOKEN: 'ghp_x',
        MY_PASSWORD: 'p',
        AWS_SECRET_ACCESS_KEY: 's',
        BASIC_AUTH: 'x',
        DB_CREDENTIAL: 'c',
        ELECTRON_RUN_AS_NODE: '1',
        HTTPS_PROXY: 'http://user:pass@proxy.internal:8080',
      },
      stdout: 'ok',
    });
    await execOnce({ command: 'echo ok' }, ctx(), fake.deps);
    const env = fake.calls[0]?.options['env'] as Record<string, string>;
    expect(env['PATH']).toBe('C:\\Windows');
    for (const k of [
      'OPENAI_API_KEY',
      'GITHUB_TOKEN',
      'MY_PASSWORD',
      'AWS_SECRET_ACCESS_KEY',
      'BASIC_AUTH',
      'DB_CREDENTIAL',
      'ELECTRON_RUN_AS_NODE',
    ]) {
      expect(env).not.toHaveProperty(k);
    }
    // 代理保留（否则公司网络里的命令直接坏掉），但内嵌口令被脱掉
    expect(env['HTTPS_PROXY']).toBe('http://proxy.internal:8080');
    expect(env['JUJIA_WORKSPACE']).toBe(root);
  });

  it('cwd 作为工作目录传给 spawn，且 windowsHide / shell:false', async () => {
    const fake = makeFake({ stdout: 'ok' });
    await execOnce({ command: 'echo hi' }, ctx(), fake.deps);
    const o = fake.calls[0]?.options as Record<string, unknown>;
    expect(o['cwd']).toBe(root);
    expect(o['windowsHide']).toBe(true);
    expect(o['shell']).toBe(false);
  });

  it('stdin 立即关闭 —— 交互式命令不该被吊着', async () => {
    const fake = makeFake({ stdout: 'ok' });
    await execOnce({ command: 'echo hi' }, ctx(), fake.deps);
    expect(fake.stdinEnded).toBe(true);
  });
});

describe('结果如何如实呈现', () => {
  it('非零退出码是**信息**而不是工具故障（模型要看得到 stdout/stderr）', async () => {
    const fake = makeFake({ exitCode: 3, stdout: '部分输出', stderr: '错在哪' });
    const r = await execOnce({ command: 'build' }, ctx(), fake.deps);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('退出码 3');
    expect(r.content).toContain('部分输出');
    expect(r.content).toContain('[stderr]');
    expect(r.content).toContain('错在哪');
  });

  it('超时：标注超时与被强制结束，且明确区别于"用户拒绝"', async () => {
    const fake = makeFake({ hang: true });
    const r = await execOnce({ command: 'sleep 999', timeoutMs: 200 }, ctx(), fake.deps);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('超时');
    expect(r.content).toContain('与"用户拒绝"是两回事');
  });

  it('输出超限：内容被裁并且**如实标注**不是全文', async () => {
    const fake = makeFake({ stdout: 'y'.repeat(MAX_EXEC_OUTPUT_BYTES + 4096) });
    const r = await execOnce({ command: 'huge' }, ctx(), fake.deps);
    expect(r.content).toContain('已截断');
    expect(r.evidence?.truncated).toBe(true);
    expect(Buffer.byteLength(r.content, 'utf8')).toBeLessThan(MAX_EXEC_OUTPUT_BYTES + 2000);
  });

  it('证据里带上工作目录与耗时（审计要看得到命令落在哪）', async () => {
    const fake = makeFake({ stdout: 'ok' });
    const r = await execOnce({ command: 'echo ok' }, ctx(), fake.deps);
    expect(r.evidence?.paths).toEqual([root]);
    expect(typeof r.evidence?.durationMs).toBe('number');
  });

  it('spawn 之后进程报错 → io_error，不静默返回空结果', async () => {
    const fake = makeFake({ hang: true });
    const p = execOnce({ command: 'x', timeoutMs: 5_000 }, ctx(), fake.deps);
    // 真实进程也是"先报错、再退出"，顺序反了就等于测的是超时分支
    fake.emitError(new Error('ENOENT 找不到可执行文件'));
    fake.finish();
    await expect(p).rejects.toThrow(/ENOENT/);
  });
});

/* ---------------- 与权限门的接合（本轮核心验收点） ---------------- */

describe('run_command 走的是与文件工具同一套权限门', () => {
  async function withResolver(decision: PermissionDecision) {
    const asked: PermissionRequest[] = [];
    const fake = makeFake({ stdout: 'ran', exitCode: 0 });
    const tool = {
      ...runCommandTool,
      run: (args: never, c: ToolContext) => execOnce(args as { command: string; cwd?: string | undefined }, c, fake.deps),
    };
    const res = await runTool(tool, { command: 'echo ran' }, ctx(), async (req) => {
      asked.push(req);
      return decision;
    });
    return { asked, fake, res };
  }

  it('一定会问（执行类硬 ask），并且**弹窗标题里就有命令行本身**', async () => {
    const { asked, res } = await withResolver('allow_once');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.kind).toBe('exec');
    expect(res.asked).toBe(true);
    // 只写"run_command · 执行命令"等于让人不看内容就批准
    expect(asked[0]?.summary).toContain('echo ran');
  });

  it('拒绝 → **零执行**：spawn 一次都没被调用，磁盘上没留任何东西', async () => {
    const { fake, res } = await withResolver('deny');
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('拒绝');
    expect(fake.calls).toHaveLength(0);
    const leftovers = await stat(join(root, 'should-not-exist')).then(
      () => true,
      () => false,
    );
    expect(leftovers).toBe(false);
  });

  it('对执行类回答「总是允许」**不会**被记住 —— 下一次照样问', async () => {
    const alwaysAllow = new Set<string>();
    const fake = makeFake({ stdout: 'ran' });
    const tool = {
      ...runCommandTool,
      run: (args: never, c: ToolContext) => execOnce(args as { command: string }, c, fake.deps),
    };
    const asked: string[] = [];
    const resolver = async (req: PermissionRequest): Promise<PermissionDecision> => {
      asked.push(req.toolName);
      return 'allow_always';
    };
    await runTool(tool, { command: 'a' }, ctx(), resolver, { alwaysAllow });
    await runTool(tool, { command: 'b' }, ctx(), resolver, { alwaysAllow });
    expect(asked).toEqual([EXEC_TOOL_NAME, EXEC_TOOL_NAME]);
    expect([...alwaysAllow]).toEqual([]);
  });
});

/* ---------------- 注册表 ---------------- */

describe('默认注册表里真的有它（不是写了个工具却没人能调到）', () => {
  it('createDefaultRegistry 含 三个文件工具 + run_command + append_note（清单变了要红，逼着登记）', () => {
    const registry = createDefaultRegistry();
    expect(registry.has(EXEC_TOOL_NAME)).toBe(true);
    expect(registry.get(EXEC_TOOL_NAME).kind).toBe('exec');
    expect(registry.names()).toEqual(['append_note', 'list_dir', 'read_file', 'run_command', 'write_file']);
  });
});

/* ---------------- 真进程冒烟（证明 shell 选择与真实管道接得上） ---------------- */

describe('真跑一条命令（不注入假 spawn）', () => {
  it('echo 出来的内容能回到结果里', async () => {
    const marker = `exec-${String(Date.now())}`;
    const r = await runCommandTool.run({ command: `echo ${marker}` }, ctx());
    expect(r.ok).toBe(true);
    expect(r.content).toContain(marker);
    expect(r.content).toContain('退出码 0');
  });

  it('真实命令写盘：文件确实出现在工作区里（端到端真值）', async () => {
    const target = 'exec-created.txt';
    const cmd =
      process.platform === 'win32'
        ? `echo hello > ${target}`
        : `printf 'hello' > ${target}`;
    const r = await runCommandTool.run({ command: cmd }, ctx());
    expect(r.ok).toBe(true);
    const info = await stat(join(root, target)).catch(() => null);
    expect(info !== null && info.size > 0).toBe(true);
  });

  it('真实超时：给一个跑不完的命令，结果里写的是超时而不是挂死', async () => {
    const cmd = process.platform === 'win32' ? 'ping -n 30 127.0.0.1 >nul' : 'sleep 30';
    const r = await runCommandTool.run({ command: cmd, timeoutMs: 800 }, ctx());
    expect(r.content).toContain('超时');
  });
});
