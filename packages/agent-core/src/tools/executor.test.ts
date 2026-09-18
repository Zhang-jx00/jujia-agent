import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileTool, writeFileTool } from './builtin/file-tools';
import { runTool, type PermissionDecision, type PermissionRequest } from './executor';
import { createDefaultRegistry, ToolRegistry } from './registry';
import { ToolError } from './types';

/**
 * 权限门与工具执行的对抗性测试。
 * 重点不在「能不能跑通」，而在**不该发生的事一定不发生**：
 * 被拒绝时磁盘必须没被动过、绝对不自动放行写操作。
 */

let root: string;
const ctx = (): { workspaceRoot: string } => ({ workspaceRoot: root });

function fixedResolver(decision: PermissionDecision): {
  resolver: (req: PermissionRequest) => Promise<PermissionDecision>;
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
