import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileTool, writeFileTool } from './builtin/file-tools';
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
  it('默认注册表含三个内置文件工具', () => {
    const registry = createDefaultRegistry();
    expect(registry.names()).toEqual(['list_dir', 'read_file', 'write_file']);
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
