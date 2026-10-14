import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDirTool, readFileTool, writeFileTool } from './builtin/file-tools';
import {
  runTool,
  type PermissionAnswer,
  type PermissionDecision,
  type PermissionRequest,
} from './executor';
import { createDefaultRegistry, ToolRegistry } from './registry';
import { ToolError } from './types';

/**
 * 权限门与工具执行的对抗性测试。
 * 重点不在「能不能跑通」，而在**不该发生的事一定不发生**：
 * 被拒绝时磁盘必须没被动过、绝对不自动放行写操作。
 */

let root: string;
const ctx = (): { workspaceRoot: string } => ({ workspaceRoot: root });

function fixedResolver(decision: PermissionDecision | PermissionAnswer): {
  resolver: (req: PermissionRequest) => Promise<PermissionDecision | PermissionAnswer>;
  asked: PermissionRequest[];
} {
  const asked: PermissionRequest[] = [];
  return {
    asked,
    resolver: (req) => {
      asked.push(req);
      return Promise.resolve(decision);
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-exec-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('权限门策略', () => {
  it('读工具自动放行，不打扰用户', async () => {
    const { resolver, asked } = fixedResolver('deny');
    const res = await runTool(readFileTool, { path: 'missing.txt' }, ctx(), resolver);

    expect(asked).toHaveLength(0); // 关键：读操作不询问
    expect(res.asked).toBe(false);
    expect(res.outcome.ok).toBe(false); // 文件不存在是另一回事
    expect(res.outcome.content).toContain('not_found');
  });

  it('写工具必须询问；用户同意后确实落盘', async () => {
    const { resolver, asked } = fixedResolver('allow_once');
    const res = await runTool(
      writeFileTool as never,
      { path: 'hello.txt', content: '你好' },
      ctx(),
      resolver,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]?.toolName).toBe('write_file');
    expect(asked[0]?.kind).toBe('write');
    expect(asked[0]?.paths).toEqual(['hello.txt']);
    expect(res.outcome.ok).toBe(true);
    expect(await readFile(join(root, 'hello.txt'), 'utf8')).toBe('你好');
  });

  it('用户拒绝 → 磁盘不得被修改（最关键的安全断言）', async () => {
    const { resolver } = fixedResolver('deny');
    const res = await runTool(
      writeFileTool as never,
      { path: 'should-not-exist.txt', content: 'x' },
      ctx(),
      resolver,
    );

    expect(res.outcome.ok).toBe(false);
    expect(res.decision).toBe('deny');
    await expect(stat(join(root, 'should-not-exist.txt'))).rejects.toThrow();
  });

  it('等待超时 → 与「拒绝」文案不同，且同样不落盘', async () => {
    const { resolver } = fixedResolver('timeout');
    const res = await runTool(
      writeFileTool as never,
      { path: 'timeout.txt', content: 'x' },
      ctx(),
      resolver,
    );

    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('超时');
    expect(res.outcome.content).not.toContain('用户拒绝');
    await expect(stat(join(root, 'timeout.txt'))).rejects.toThrow();
  });

  it('「总是允许」写入会话白名单后，同工具不再询问', async () => {
    const alwaysAllow = new Set<string>();
    const first = fixedResolver('allow_always');
    await runTool(writeFileTool, { path: 'a.txt', content: '1' }, ctx(), first.resolver, {
      alwaysAllow,
    });
    expect(alwaysAllow.has('write_file')).toBe(true);

    const second = fixedResolver('deny'); // 即便 resolver 想说拒绝，也不该被调用
    const res = await runTool(
      writeFileTool as never,
      { path: 'b.txt', content: '2' },
      ctx(),
      second.resolver,
      { alwaysAllow },
    );
    expect(second.asked).toHaveLength(0);
    expect(res.outcome.ok).toBe(true);
  });

  it('edit：允许但改参数 → 用**改后**的参数执行（不是原始参数）', async () => {
    // 场景：Agent 想写 note.md，用户把路径改成 safe/note.md 再放行
    const { resolver, asked } = fixedResolver({
      decision: 'edit',
      updatedArgs: { path: 'safe/note.md', content: '用户改过的内容' },
    });

    const res = await runTool(
      writeFileTool,
      { path: 'note.md', content: '模型原本想写的内容' },
      ctx(),
      resolver,
    );

    expect(asked).toHaveLength(1);
    expect(res.decision).toBe('edit');
    expect(res.outcome.ok).toBe(true);
    // 改后的路径被写入，原始路径不存在
    expect(await readFile(join(root, 'safe', 'note.md'), 'utf8')).toBe('用户改过的内容');
    await expect(stat(join(root, 'note.md'))).rejects.toThrow();
  });

  it('edit：改后的参数不合法 → 如实报错且不执行', async () => {
    const { resolver } = fixedResolver({ decision: 'edit', updatedArgs: { path: 123 } });

    const res = await runTool(
      writeFileTool,
      { path: 'a.txt', content: 'x' },
      ctx(),
      resolver,
    );

    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('经用户修改后');
    await expect(stat(join(root, 'a.txt'))).rejects.toThrow();
  });

  it('edit：改后的路径仍受沙箱约束（越界照样拒绝且不落盘）', async () => {
    const { resolver } = fixedResolver({
      decision: 'edit',
      updatedArgs: { path: '../escaped.txt', content: 'x' },
    });

    const res = await runTool(
      writeFileTool,
      { path: 'ok.txt', content: 'x' },
      ctx(),
      resolver,
    );

    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('path_denied');
    await expect(stat(join(root, '..', 'escaped.txt'))).rejects.toThrow();
  });

  it('参数不合法 → 直接失败，不打扰用户', async () => {
    const { resolver, asked } = fixedResolver('allow_once');
    const res = await runTool(readFileTool, { notPath: 1 }, ctx(), resolver);
    expect(asked).toHaveLength(0);
    expect(res.outcome.content).toContain('参数不合法');
  });
});

describe('内置文件工具', () => {
  it('write → read → list 的完整往返', async () => {
    const allow = fixedResolver('allow_once');
    await runTool(
      writeFileTool as never,
      { path: 'sub/notes.md', content: '# 标题\n正文' },
      ctx(),
      allow.resolver,
    );

    const read = await runTool(readFileTool, { path: 'sub/notes.md' }, ctx(), allow.resolver);
    expect(read.outcome.ok).toBe(true);
    expect(read.outcome.content).toContain('# 标题');
    expect(read.outcome.evidence?.bytes).toBeGreaterThan(0);

    const registry = createDefaultRegistry();
    const list = await runTool(
      registry.get('list_dir'),
      { path: '.' },
      ctx(),
      allow.resolver,
    );
    expect(list.outcome.content).toContain('sub/');
  });

  /**
   * K-1 的同类修复：三个文件工具的 JSON Schema 都声明了 `additionalProperties: false`，
   * 但 zod 默认**静默丢弃**多余字段 —— 声明与执行两套口径就是长期存在的注入面。
   * 这条测试的职责就是"声明说了不许，parse 就得真的拒绝"。
   */
  it('多余字段一律拒绝（声明与执行必须同一套口径）', () => {
    expect(() => readFileTool.parse({ path: 'a.txt', extra: 1 })).toThrow();
    expect(() => writeFileTool.parse({ path: 'a.txt', content: 'x', mode: 'overwrite' })).toThrow();
    expect(() => listDirTool.parse({ path: '.', depth: 9 })).toThrow();
    // 合法入参照旧通过（不能把"严格"写成"用不了"）
    expect(readFileTool.parse({ path: 'a.txt' })).toEqual({ path: 'a.txt' });
    expect(listDirTool.parse(undefined)).toEqual({});
  });

  it('多余字段在**权限门之前**就被拒，且不弹窗、不落盘', async () => {
    const allow = fixedResolver('allow_once');
    const res = await runTool(
      writeFileTool as never,
      { path: 'evil.txt', content: 'x', overwrite: true },
      ctx(),
      allow.resolver,
    );
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('参数不合法');
    expect(res.asked).toBe(false);
    expect(allow.asked).toHaveLength(0);
    const exists = await stat(join(root, 'evil.txt')).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);
  });

  it('超长文件被截断并如实标注（不得假装完整）', async () => {
    const allow = fixedResolver('allow_once');
    const big = 'a'.repeat(1000);
    await runTool(writeFileTool, { path: 'big.txt', content: big }, ctx(), allow.resolver);

    const res = await runTool(readFileTool, { path: 'big.txt', maxBytes: 100 }, ctx(), allow.resolver);
    expect(res.outcome.content).toContain('已截断');
    expect(res.outcome.evidence?.truncated).toBe(true);
  });

  it('写入越界路径 → 即使已授权也拒绝，且不落盘', async () => {
    const allow = fixedResolver('allow_once');
    const res = await runTool(
      writeFileTool as never,
      { path: '../escaped.txt', content: 'x' },
      ctx(),
      allow.resolver,
    );

    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('path_denied');
    await expect(stat(join(root, '..', 'escaped.txt'))).rejects.toThrow();
  });

  it('把目录当文件读 → 明确报错并提示改用 list_dir', async () => {
    const allow = fixedResolver('allow_once');
    const res = await runTool(readFileTool, { path: '.' }, ctx(), allow.resolver);
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('list_dir');
  });

  it('工具内部的 ToolError 被结构化返回（不抛给调用方）', async () => {
    const allow = fixedResolver('allow_once');
    const res = await runTool(readFileTool, { path: 'nope.txt' }, ctx(), allow.resolver);
    expect(res.outcome.content).toMatch(/^\[not_found\]/);
  });
});

describe('注册表', () => {
  it('默认注册表 = 三个文件工具 + 一个执行工具 + 一个记忆写入工具（清单变了这条就该红，逼着登记）', () => {
    const registry = createDefaultRegistry();
    expect(registry.names()).toEqual(['append_note', 'list_dir', 'read_file', 'run_command', 'write_file']);
    // 执行工具必须是 exec 类：这是"每次硬 ask、总是允许压不掉"的唯一依据
    expect(registry.get('run_command').kind).toBe('exec');
  });

  it('未注册的工具名 → 明确报错（不做模糊匹配）', () => {
    const registry = createDefaultRegistry();
    expect(() => registry.get('rm_rf')).toThrowError(/未注册的工具/);
  });

  it('重复注册同名工具 → 报错（防止悄悄覆盖实现）', () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    expect(() => registry.register(readFileTool as never)).toThrowError(/重复注册/);
  });

  it('导出给模型的形态只含 name/description/parameters', () => {
    const tools = createDefaultRegistry().toOpenAiTools();
    const first = tools[0];
    expect(first?.type).toBe('function');
    expect(Object.keys(first?.function ?? {}).sort()).toEqual([
      'description',
      'name',
      'parameters',
    ]);
  });

  it('ToolError 可被 instanceof 识别（执行器据此区分安全错误）', () => {
    expect(new ToolError('path_denied', 'x')).toBeInstanceOf(ToolError);
  });
});

describe('策略层接入（W10g）：模式与用户规则真正作用于执行', () => {
  const denyResolver = () => {
    throw new Error('不应询问用户');
  };

  it('deny 规则 → 不弹窗、不执行，并说明命中的规则', async () => {
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'a.txt'), content: 'x' },
      ctx(),
      denyResolver,
      { rules: [{ id: 'r1', pattern: 'write_file', action: 'deny', enabled: true, createdAt: '', updatedAt: '' }] },
    );
    expect(res.asked).toBe(false);
    expect(res.decision).toBe('deny');
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('命中你的规则');
    // 磁盘必须没被动过
    await expect(stat(join(root, 'a.txt'))).rejects.toThrow();
  });

  it('allow 规则 → exec 类工具不再弹窗即可执行', async () => {
    const tool = createDefaultRegistry().get('list_dir');
    const res = await runTool(tool, {}, ctx(), denyResolver, {
      rules: [{ id: 'r1', pattern: 'list_dir', action: 'allow', enabled: true, createdAt: '', updatedAt: '' }],
      // 刻意不传 mode：default 模式下 exec 本来要问
    });
    expect(res.asked).toBe(false);
    expect(res.outcome.ok).toBe(true);
  });

  it('ask 规则可以让**只读**工具也来问（此前只读从不打扰）', async () => {
    const asked: PermissionRequest[] = [];
    const res = await runTool(
      readFileTool,
      { path: join(root, 'nope.txt') },
      ctx(),
      async (req) => {
        asked.push(req);
        return 'deny';
      },
      { rules: [{ id: 'r1', pattern: 'read_file', action: 'ask', enabled: true, createdAt: '', updatedAt: '' }] },
    );
    expect(res.asked).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('deny 规则优先于会话内 alwaysAllow（"绝不碰"是承诺）', async () => {
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'b.txt'), content: 'x' },
      ctx(),
      denyResolver,
      {
        alwaysAllow: new Set(['write_file']),
        rules: [{ id: 'r1', pattern: 'write_file', action: 'deny', enabled: true, createdAt: '', updatedAt: '' }],
      },
    );
    expect(res.decision).toBe('deny');
    expect(res.outcome.ok).toBe(false);
    await expect(stat(join(root, 'b.txt'))).rejects.toThrow();
  });

  it('plan 模式在运行时真的拒绝写入（此前模式是死代码）', async () => {
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'c.txt'), content: 'x' },
      ctx(),
      denyResolver,
      { mode: 'plan' },
    );
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('计划（只读）');
    await expect(stat(join(root, 'c.txt'))).rejects.toThrow();
  });

  it('allow 规则在 plan 模式下**不**生效（会话级只读意图优先于常设规则）', async () => {
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'd.txt'), content: 'x' },
      ctx(),
      denyResolver,
      {
        mode: 'plan',
        rules: [{ id: 'r1', pattern: 'write_file', action: 'allow', enabled: true, createdAt: '', updatedAt: '' }],
      },
    );
    expect(res.outcome.ok).toBe(false);
  });

  it('默认（无规则、default 模式）行为与从前一致：读放行、写要问', async () => {
    const asked: PermissionRequest[] = [];
    const read = await runTool(readFileTool, { path: join(root, 'x.txt') }, ctx(), async (req) => {
      asked.push(req);
      return 'deny';
    });
    expect(read.asked).toBe(false);

    const write = await runTool(writeFileTool, { path: join(root, 'x.txt'), content: 'x' }, ctx(), async (req) => {
      asked.push(req);
      return 'deny';
    });
    expect(write.asked).toBe(true);
    expect(asked).toHaveLength(1);
  });
});

describe('对抗性实验（复核 010）：模式 + 规则叠加时，不该发生的事必须不发生', () => {
  it('plan 模式下模型尝试写敏感文件（.env）→ 被拒且磁盘未动，且不弹窗', async () => {
    const target = join(root, '.env.local');
    const res = await runTool(
      writeFileTool,
      { path: target, content: 'TOKEN=leaked' },
      ctx(),
      () => {
        throw new Error('plan 模式下不应询问用户');
      },
      { mode: 'plan' },
    );
    expect(res.outcome.ok).toBe(false);
    expect(res.asked).toBe(false);
    await expect(stat(target)).rejects.toThrow();
  });

  it('deny 规则 + alwaysAllow + bypassPermissions 三者叠加：deny 仍然赢', async () => {
    const target = join(root, 'guard.txt');
    const res = await runTool(
      writeFileTool,
      { path: target, content: 'x' },
      ctx(),
      () => {
        throw new Error('deny 规则命中时不应询问用户');
      },
      {
        mode: 'bypassPermissions',
        alwaysAllow: new Set(['write_file']),
        rules: [{ id: 'r1', pattern: 'write_*', action: 'deny', note: '绝不写入', enabled: true, createdAt: '', updatedAt: '' }],
      },
    );
    expect(res.decision).toBe('deny');
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('绝不写入');
    await expect(stat(target)).rejects.toThrow();
  });

  it('ask 规则命中只读工具：拒绝后磁盘未动、结果如实回传（不伪装成功）', async () => {
    const res = await runTool(
      readFileTool,
      { path: join(root, 'secret.txt') },
      ctx(),
      async () => 'deny',
      { rules: [{ id: 'r1', pattern: 'read_*', action: 'ask', enabled: true, createdAt: '', updatedAt: '' }] },
    );
    expect(res.asked).toBe(true);
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('用户拒绝');
  });

  it('禁用的 deny 规则不再拦截（开关必须真实生效，不是摆设）', async () => {
    const target = join(root, 'allowed.txt');
    const res = await runTool(
      writeFileTool,
      { path: target, content: 'ok' },
      ctx(),
      async () => 'allow_once',
      {
        rules: [{ id: 'r1', pattern: 'write_*', action: 'deny', enabled: false, createdAt: '', updatedAt: '' }],
      },
    );
    expect(res.asked).toBe(true);
    expect(res.outcome.ok).toBe(true);
    await expect(stat(target)).resolves.toBeTruthy();
  });
});

describe('生命周期钩子接入（W5d）：钩子能拒绝、能改写、能补充上下文', () => {
  /** 假运行器：记录调用并返回预设结果（真进程的行为在 agent-core/hooks/runner.test.ts 里验） */
  function fakeHooks(results: Partial<Record<string, unknown>> = {}) {
    const calls: { event: string; matchTarget: string; payload: Record<string, unknown> }[] = [];
    const runner = {
      async run(p: { event: string; matchTarget: string; payload: Record<string, unknown> }) {
        calls.push({ event: p.event, matchTarget: p.matchTarget, payload: p.payload });
        const preset = (results[p.event] ?? {}) as Record<string, unknown>;
        return {
          blocked: false,
          reason: null,
          additionalContext: [],
          updatedInput: null,
          permissionDecision: null,
          permissionReason: null,
          continueTurn: false,
          diagnostics: [],
          ranCount: 1,
          ...preset,
        };
      },
    };
    return { runner, calls };
  }

  it('PreToolUse 拒绝 → 不执行、不弹窗、磁盘未动', async () => {
    const { runner, calls } = fakeHooks({ PreToolUse: { blocked: true, reason: '今天不许写文件' } });
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'hooked.txt'), content: 'x' },
      ctx(),
      () => {
        throw new Error('钩子已拒绝，不应询问用户');
      },
      { hooks: runner },
    );
    expect(res.asked).toBe(false);
    expect(res.decision).toBe('deny');
    expect(res.outcome.content).toContain('今天不许写文件');
    await expect(stat(join(root, 'hooked.txt'))).rejects.toThrow();
    // 被拒绝后不应再触发 Post 钩子
    expect(calls.map((c) => c.event)).toEqual(['PreToolUse']);
    expect(calls[0]?.payload['toolName']).toBe('write_file');
  });

  it('PreToolUse 改写参数 → **重新过参数校验**后执行（改写不能变成绕过校验的后门）', async () => {
    const { runner } = fakeHooks({ PreToolUse: { updatedInput: { path: join(root, 'rewritten.txt'), content: 'from-hook' } } });
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'original.txt'), content: 'x' },
      ctx(),
      async () => 'allow_once',
      { hooks: runner },
    );
    expect(res.outcome.ok).toBe(true);
    expect(await readFile(join(root, 'rewritten.txt'), 'utf8')).toBe('from-hook');
    await expect(stat(join(root, 'original.txt'))).rejects.toThrow();
  });

  it('PreToolUse 改写出非法参数 → 拒绝执行并说明原因', async () => {
    const { runner } = fakeHooks({ PreToolUse: { updatedInput: { bogus: true } } });
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'legit.txt'), content: 'x' },
      ctx(),
      async () => 'allow_once',
      { hooks: runner },
    );
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('改写后的参数不合法');
    await expect(stat(join(root, 'legit.txt'))).rejects.toThrow();
  });

  it('PreToolUse 把只读工具改写到敏感路径 → 改写后的参数**重新过门**，问的是新路径（T49）', async () => {
    // 病根（2026-10-14 核心包审计线抓到）：`decideGate` 在钩子**之前**只算一次，
    // 钩子改写 args 之后只重过 `tool.parse`，**没有重过权限门**。
    // 于是 `read_file notes.md`（只读放行）被改成 `read_file .env` 时，那扇门再没看过它一眼 ——
    // 而 T1 把敏感检查提到"任何 allow 之前"，正是为了拦住这一次读取。
    const secret = join(root, '.env');
    await writeFile(secret, 'API_KEY=sk-hookbypassvalue-1234567890\n', 'utf8');
    const { runner } = fakeHooks({ PreToolUse: { updatedInput: { path: secret } } });
    const { resolver, asked } = fixedResolver('deny');
    const res = await runTool(
      readFileTool,
      { path: join(root, 'notes.md') },
      ctx(),
      resolver,
      { hooks: runner },
    );
    expect(res.asked).toBe(true);
    expect(asked).toHaveLength(1);
    expect(JSON.stringify(asked[0]?.args)).toContain('.env'); // 问的是改写后的那个路径
    expect(res.decision).toBe('deny');
    expect(res.outcome.content).not.toContain('sk-hookbypassvalue');
  });

  it('反向对照：改写后仍是普通路径 → 一次都不许多问（重判不等于逢改必问）', async () => {
    const other = join(root, 'other.txt');
    await writeFile(other, '普通内容\n', 'utf8');
    const { runner } = fakeHooks({ PreToolUse: { updatedInput: { path: other } } });
    const { resolver, asked } = fixedResolver('allow_once');
    const res = await runTool(
      readFileTool,
      { path: join(root, 'notes.md') },
      ctx(),
      resolver,
      { hooks: runner },
    );
    expect(asked).toHaveLength(0);
    expect(res.outcome.ok).toBe(true);
    expect(res.outcome.content).toBe('普通内容\n');
  });

  it('改写前的软 ask 压不掉改写后的硬 ask：「本次总是允许」不许替用户签敏感路径（T49）', async () => {
    // 同一处病根的第二个方向，也是更贵的那个：`alwaysAllowed` 用的是**改写前**的 `gate.bypassable`。
    // `write_file normal.txt` 是软 ask（可被"总是允许"压掉），钩子把它换成 `.env` 就是硬 ask ——
    // 旧代码照旧压掉，于是勾选过一次"总是允许"之后，敏感文件被静默改写。
    const secret = join(root, '.env');
    await writeFile(secret, 'A=1\n', 'utf8');
    const { runner } = fakeHooks({ PreToolUse: { updatedInput: { path: secret, content: 'by-hook' } } });
    const { resolver, asked } = fixedResolver('deny');
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'normal.txt'), content: 'x' },
      ctx(),
      resolver,
      { hooks: runner, alwaysAllow: new Set(['write_file']) },
    );
    expect(asked).toHaveLength(1); // 改写前不问也算对，但改写后**必须**问
    expect(res.decision).toBe('deny');
    expect(await readFile(secret, 'utf8')).toBe('A=1\n');
    await expect(stat(join(root, 'normal.txt'))).rejects.toThrow();
  });

  it('PermissionRequest 钩子 allow → 跳过弹窗直接执行（审批策略可编程）', async () => {
    const { runner, calls } = fakeHooks({ PermissionRequest: { permissionDecision: 'allow' } });
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'policy-allowed.txt'), content: 'ok' },
      ctx(),
      () => {
        throw new Error('钩子已放行，不应弹窗');
      },
      { hooks: runner },
    );
    expect(res.asked).toBe(false);
    expect(res.outcome.ok).toBe(true);
    expect(calls.map((c) => c.event)).toEqual(['PreToolUse', 'PermissionRequest', 'PostToolUse']);
  });

  it('PermissionRequest 钩子 deny → 不弹窗、不执行', async () => {
    const { runner } = fakeHooks({ PermissionRequest: { permissionDecision: 'deny', permissionReason: '策略程序说不' } });
    const res = await runTool(
      writeFileTool,
      { path: join(root, 'policy-denied.txt'), content: 'x' },
      ctx(),
      () => {
        throw new Error('钩子已拒绝，不应弹窗');
      },
      { hooks: runner },
    );
    expect(res.asked).toBe(false);
    expect(res.decision).toBe('deny');
    expect(res.outcome.content).toContain('策略程序说不');
    await expect(stat(join(root, 'policy-denied.txt'))).rejects.toThrow();
  });

  it('PostToolUse 的 additionalContext 会被并入工具结果（模型看到的是同一条结果）', async () => {
    const { runner, calls } = fakeHooks({ PostToolUse: { additionalContext: ['记得跑测试'] } });
    // 必须让工具真的**成功**：读不存在的文件是失败路径，走的是 PostToolUseFailure
    const target = join(root, 'existing.txt');
    await writeFile(target, 'hello', 'utf8');
    const res = await runTool(readFileTool, { path: target }, ctx(), async () => 'deny', { hooks: runner });
    expect(res.outcome.ok).toBe(true);
    expect(calls.map((c) => c.event)).toContain('PostToolUse');
    expect(res.outcome.content).toContain('[钩子补充上下文]');
    expect(res.outcome.content).toContain('记得跑测试');
  });

  it('工具失败时触发 PostToolUseFailure（而不是 PostToolUse）', async () => {
    const { runner, calls } = fakeHooks({ PostToolUseFailure: { additionalContext: ['失败后建议检查路径'] } });
    const res = await runTool(readFileTool, { path: join(root, '不存在.txt') }, ctx(), async () => 'deny', {
      hooks: runner,
    });
    expect(calls.map((c) => c.event)).toContain('PostToolUseFailure');
    expect(calls.map((c) => c.event)).not.toContain('PostToolUse');
    expect(res.outcome.content).toContain('失败后建议检查路径');
  });

  it('不传 hooks 时行为与从前完全一致（默认空运行器）', async () => {
    const res = await runTool(writeFileTool, { path: join(root, 'plain.txt'), content: 'ok' }, ctx(), async () => 'allow_once');
    expect(res.outcome.ok).toBe(true);
    expect(res.outcome.content).not.toContain('钩子');
  });
});

/**
 * 命令前缀规则的**接线**（M4 收尾 · 其一）。
 *
 * rules.test.ts 已经证明"会不会命中"，这一组只证明另一件事：运行时真的走到它。
 * 工具必须自己声明哪条参数是命令行，执行器必须把这条声明送到策略层 ——
 * 少接一环，用户看到的就是一条"写了却不生效"的 deny 规则，那比没有这条规则更坏。
 */
describe('命令前缀规则接线（不是只活在单测里）', () => {
  const rmRule = {
    id: 'p1',
    pattern: 'run_command',
    action: 'deny' as const,
    argPrefix: 'rm -rf',
    enabled: true,
    createdAt: '',
    updatedAt: '',
  };
  const neverAsk = (): never => {
    throw new Error('不该走到询问');
  };

  it('run_command 声明了自己的命令参数（没声明的话，前缀规则就是假能力）', () => {
    expect(createDefaultRegistry().get('run_command').commandArg).toBe('command');
  });

  it('命中前缀的命令在执行器这一层就被拒：不弹窗、不 spawn', async () => {
    const tool = createDefaultRegistry().get('run_command');
    const res = await runTool(tool, { command: 'rm -rf build' }, ctx(), neverAsk, { rules: [rmRule] });
    expect(res.asked).toBe(false);
    expect(res.decision).toBe('deny');
    expect(res.outcome.content).toContain('命中你的规则');
    expect(res.outcome.content).toContain('rm -rf');
  });

  it('没命中前缀的命令照常弹审批（规则窄了不等于放行松了）', async () => {
    const tool = createDefaultRegistry().get('run_command');
    const asked: PermissionRequest[] = [];
    const res = await runTool(tool, { command: 'ls -la' }, ctx(), async (req) => {
      asked.push(req);
      return 'deny';
    }, { rules: [rmRule] });
    expect(asked).toHaveLength(1);
    expect(res.decision).toBe('deny');
  });

  it('只有执行类工具能声明 commandArg（否则前缀不命中会回落成可被"总是允许"压掉的软 ask）', () => {
    for (const tool of createDefaultRegistry().all()) {
      if (tool.commandArg !== undefined) expect(`${tool.name}:${tool.kind}`).toBe(`${tool.name}:exec`);
    }
  });
});
