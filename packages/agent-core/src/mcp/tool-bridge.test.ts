import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry';
import { runTool } from '../tools/executor';
import type { ToolContext } from '../tools/types';
import type { McpToolProfile } from './mcp';
import type { ApprovalOutcome } from './consent';
import {
  MAX_MCP_RESULT_BYTES,
  MAX_TOOL_NAME_LENGTH,
  buildToolDescription,
  clampText,
  normalizeInputSchema,
  registerMcpTools,
  toModelToolName,
  toStoredTool,
  unregisterMcpTools,
  type McpToolRuntime,
} from './tool-bridge';

const ctx: ToolContext = { workspaceRoot: 'D:/ws' };

function profile(over: Partial<McpToolProfile> = {}): McpToolProfile {
  return {
    qualifiedName: 'srv__do_thing',
    serverId: 'srv',
    rawName: 'do_thing',
    kind: 'exec',
    description: '远端工具',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    kindReason: '服务端未提供注解 → 默认按最严格处理',
    ...over,
  };
}

function approval(enabled: string[], approved = true): ApprovalOutcome {
  return { approved, enabledTools: enabled, note: '' };
}

function fakeRuntime(fn: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>): McpToolRuntime & { calls: Array<{ name: string; args: unknown }> } {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return fn(name, args);
    },
  };
}

describe('toModelToolName（模型侧工具名）', () => {
  it('合法名原样返回', () => {
    expect(toModelToolName('srv__read_file')).toBe('srv__read_file');
  });

  it('非法字符（空格/点/冒号/中文）统一替换为下划线', () => {
    expect(toModelToolName('my server__read.file')).toBe('my_server__read_file');
    expect(toModelToolName('a b.c:d')).toBe('a_b_c_d');
    // 逐字符核对：4 个非字母数字字符 → 4 个下划线，保留其中的 1 与两个下划线
    expect(toModelToolName('服务器:1__工具')).toBe('____1____');
  });

  it('清洗后不含字母数字 → null（否则纯中文名会塌缩成同一个下划线串）', () => {
    expect(toModelToolName('中文')).toBeNull();
    expect(toModelToolName('中文名')).toBeNull();
    expect(toModelToolName('日本語')).toBeNull();
    expect(toModelToolName('')).toBeNull();
  });

  it('超长名被截断到上限以内（含哈希后缀）', () => {
    const long = `${'x'.repeat(200)}__tool`;
    const name = toModelToolName(long);
    expect(name).not.toBeNull();
    expect((name as string).length).toBeLessThanOrEqual(MAX_TOOL_NAME_LENGTH);
    expect(name as string).toContain('_');
  });

  it('超长名不会塌缩成同一个：后缀不同', () => {
    const a = toModelToolName(`${'x'.repeat(200)}__alpha`);
    const b = toModelToolName(`${'x'.repeat(200)}__beta`);
    expect(a).not.toBe(b);
  });

  it('同一输入两次调用结果一致（确定性，便于审计与复现）', () => {
    const long = `${'y'.repeat(120)}__tool`;
    expect(toModelToolName(long)).toBe(toModelToolName(long));
  });
});

describe('normalizeInputSchema（不替服务端做决定）', () => {
  it('非对象 / 数组 / null → 空对象 schema', () => {
    expect(normalizeInputSchema(null)).toEqual({ type: 'object', properties: {} });
    expect(normalizeInputSchema([1, 2])).toEqual({ type: 'object', properties: {} });
    expect(normalizeInputSchema('x')).toEqual({ type: 'object', properties: {} });
  });

  it('type 不是 object → 回落为空对象 schema（不假装能校验）', () => {
    expect(normalizeInputSchema({ type: 'string' })).toEqual({ type: 'object', properties: {} });
  });

  it('正常 schema 透传 properties 与 required', () => {
    const out = normalizeInputSchema({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    });
    expect(out.properties).toEqual({ a: { type: 'string' } });
    expect(out.required).toEqual(['a']);
  });

  it('required 里的非字符串项被过滤；全空则不写该字段', () => {
    expect(normalizeInputSchema({ type: 'object', properties: {}, required: [1, 'a', null] }).required).toEqual(['a']);
    expect(normalizeInputSchema({ type: 'object', properties: {}, required: [1, 2] }).required).toBeUndefined();
  });

  it('刻意不收紧 additionalProperties（第三方可能用我们看不懂的字段）', () => {
    const out = normalizeInputSchema({ type: 'object', properties: {} });
    expect('additionalProperties' in out).toBe(false);
  });

  it('properties 形状不对时回落为空对象，而不是把脏数据透传给模型', () => {
    expect(normalizeInputSchema({ type: 'object', properties: [] }).properties).toEqual({});
    expect(normalizeInputSchema({ type: 'object' }).properties).toEqual({});
  });
});

describe('clampText（截断必须如实标注）', () => {
  it('未超限：原样返回且不标截断', () => {
    const r = clampText('hello');
    expect(r.text).toBe('hello');
    expect(r.truncated).toBe(false);
  });

  it('超限：截断并带可读标注', () => {
    const big = 'a'.repeat(MAX_MCP_RESULT_BYTES + 100);
    const r = clampText(big);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('已截断');
    expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(MAX_MCP_RESULT_BYTES + 200);
  });

  it('多字节字符不被切成半个（结果里不出现替换字符 U+FFFD）', () => {
    const big = '中'.repeat(MAX_MCP_RESULT_BYTES); // 每字符 3 字节，必然超限
    const r = clampText(big);
    expect(r.truncated).toBe(true);
    expect(r.text.includes('\uFFFD')).toBe(false);
    expect(r.text.startsWith('中')).toBe(true);
  });

  it('自定义上限可用', () => {
    expect(clampText('abcdef', 3).truncated).toBe(true);
  });
});

describe('buildToolDescription（来源与权限级别必须写清楚）', () => {
  it('包含服务端来源、权限级别与分级依据', () => {
    const d = buildToolDescription(profile({ kind: 'exec', kindReason: '服务端自述具破坏性' }));
    expect(d).toContain('远端工具');
    expect(d).toContain('srv');
    expect(d).toContain('需要你逐次确认');
    expect(d).toContain('服务端自述具破坏性');
    expect(d).toContain('非本机内置工具');
  });

  it('只读工具如实写"只读（服务端声明）"', () => {
    expect(buildToolDescription(profile({ kind: 'read' }))).toContain('只读（服务端声明）');
  });
});

describe('toStoredTool（档案 → 注册表工具）', () => {
  it('工具名、分级、描述来自档案', () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'ok' }));
    const tool = toStoredTool(profile(), runtime);
    expect(tool.name).toBe('srv__do_thing');
    expect(tool.kind).toBe('exec');
    expect(tool.description).toContain('srv');
  });

  it('parse 只做最小归一：非对象入参归一为 {}，而不是抛错', () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'ok' }));
    const tool = toStoredTool(profile(), runtime);
    expect(tool.parse(null)).toEqual({});
    expect(tool.parse([1])).toEqual({});
    expect(tool.parse({ q: 'x' })).toEqual({ q: 'x' });
  });

  it('成功后回传服务端文本', async () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: '远端结果' }));
    const tool = toStoredTool(profile(), runtime);
    const out = await tool.run({ q: 'x' } as never, ctx);
    expect(out.ok).toBe(true);
    expect(out.content).toBe('远端结果');
    expect(runtime.calls[0]?.name).toBe('srv__do_thing');
  });

  it('成功但无文本 → 给出占位说明，不返回空内容让模型困惑', async () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    const tool = toStoredTool(profile(), runtime);
    const out = await tool.run({} as never, ctx);
    expect(out.ok).toBe(true);
    expect(out.content).toContain('没有返回文本内容');
  });

  it('失败：ok=false 且带上服务端原文（模型据此自我纠正）', async () => {
    const runtime = fakeRuntime(async () => ({ ok: false, text: '缺少必填参数 q' }));
    const tool = toStoredTool(profile(), runtime);
    const out = await tool.run({} as never, ctx);
    expect(out.ok).toBe(false);
    expect(out.content).toContain('缺少必填参数 q');
  });

  it('失败但服务端没给原因 → 不编造，写明"未给出失败原因"', async () => {
    const runtime = fakeRuntime(async () => ({ ok: false, text: '' }));
    const tool = toStoredTool(profile(), runtime);
    const out = await tool.run({} as never, ctx);
    expect(out.content).toContain('未给出失败原因');
  });

  it('超长结果被截断并标 truncated', async () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'z'.repeat(MAX_MCP_RESULT_BYTES + 10) }));
    const tool = toStoredTool(profile(), runtime);
    const out = await tool.run({} as never, ctx);
    expect(out.evidence?.truncated).toBe(true);
  });

  it('证据里不伪造 paths（我们无从知道第三方进程动了什么）', async () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'x' }));
    const tool = toStoredTool(profile(), runtime);
    const out = await tool.run({} as never, ctx);
    expect(out.evidence?.paths).toBeUndefined();
  });

  it('调用前已中止 → 抛 aborted，且不发起调用', async () => {
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'x' }));
    const tool = toStoredTool(profile(), runtime);
    const ac = new AbortController();
    ac.abort();
    await expect(tool.run({} as never, { ...ctx, signal: ac.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(runtime.calls).toHaveLength(0);
  });

  it('调用期间被中止 → 抛 aborted 且文案说明"请求可能已送达服务端"', async () => {
    const ac = new AbortController();
    const runtime = fakeRuntime(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, text: 'late' }), 20);
        }),
    );
    const tool = toStoredTool(profile(), runtime);
    const p = tool.run({} as never, { ...ctx, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    await expect(p).rejects.toThrow(/可能已送达/);
  });
});

describe('registerMcpTools / unregisterMcpTools', () => {
  it('未批准的工具**根本不注册**（不是隐藏）', () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    const report = registerMcpTools(registry, [profile()], approval([]), runtime);
    expect(report.registered).toEqual([]);
    expect(registry.has('srv__do_thing')).toBe(false);
    expect(registry.names()).toEqual([]);
    expect(report.skipped[0]?.reason).toContain('未批准');
  });

  it('整体拒绝（deny）→ 零工具可用', () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    const report = registerMcpTools(registry, [profile()], approval([], false), runtime);
    expect(registry.all()).toHaveLength(0);
    expect(report.registered).toEqual([]);
  });

  it('部分批准：只注册被批准的那些', () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    const a = profile({ qualifiedName: 'srv__a', rawName: 'a' });
    const b = profile({ qualifiedName: 'srv__b', rawName: 'b' });
    const report = registerMcpTools(registry, [a, b], approval(['srv__a']), runtime);
    expect(report.registered).toEqual(['srv__a']);
    expect(registry.has('srv__b')).toBe(false);
    expect(report.skipped.map((s) => s.name)).toEqual(['srv__b']);
  });

  it('与已有工具重名 → 跳过并记原因，不覆盖', () => {
    const registry = new ToolRegistry([{ ...toStoredTool(profile(), fakeRuntime(async () => ({ ok: true, text: '' }))) }]);
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'new' }));
    const report = registerMcpTools(registry, [profile()], approval(['srv__do_thing']), runtime);
    expect(report.registered).toEqual([]);
    expect(report.skipped[0]?.reason).toContain('同名');
  });

  it('一个坏工具不影响其余工具注册', () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    const bad = profile({ qualifiedName: '中文名', rawName: '中文名' });
    const good = profile({ qualifiedName: 'srv__ok', rawName: 'ok' });
    const report = registerMcpTools(registry, [bad, good], approval(['中文名', 'srv__ok']), runtime);
    expect(report.registered).toEqual(['srv__ok']);
    expect(report.skipped).toHaveLength(1);
  });

  it('卸载：返回实际摘掉的数量，不存在的名字不计入', () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    registerMcpTools(registry, [profile()], approval(['srv__do_thing']), runtime);
    expect(unregisterMcpTools(registry, ['srv__do_thing', '不存在'])).toBe(1);
    expect(registry.has('srv__do_thing')).toBe(false);
    expect(unregisterMcpTools(registry, ['srv__do_thing'])).toBe(0);
  });
});

describe('接入工具表后必须走同一套权限门（本轮核心断言）', () => {
  it('exec 类 MCP 工具会触发审批；用户拒绝时**不会真的调用远端**', async () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '不该出现' }));
    registerMcpTools(registry, [profile({ kind: 'exec' })], approval(['srv__do_thing']), runtime);
    const tool = registry.get('srv__do_thing');

    const resolver = vi.fn(async () => 'deny' as const);
    const res = await runTool(tool, { q: 'x' }, ctx, resolver);

    expect(res.asked).toBe(true);
    expect(res.decision).toBe('deny');
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.content).toContain('用户拒绝');
    // 关键：拒绝之后绝不能有副作用 —— 远端进程根本没被调用
    expect(runtime.calls).toHaveLength(0);
  });

  it('同意后才会真正调用远端，并把结果回传', async () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '远端已执行' }));
    registerMcpTools(registry, [profile({ kind: 'exec' })], approval(['srv__do_thing']), runtime);
    const tool = registry.get('srv__do_thing');

    const res = await runTool(tool, { q: 'x' }, ctx, async () => 'allow_once' as const);
    expect(res.asked).toBe(true);
    expect(res.outcome.ok).toBe(true);
    expect(res.outcome.content).toBe('远端已执行');
    expect(runtime.calls).toHaveLength(1);
  });

  it('服务端明确声明只读的工具：不打扰用户（只读不询问）', async () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: 'read ok' }));
    registerMcpTools(registry, [profile({ kind: 'read' })], approval(['srv__do_thing']), runtime);
    const tool = registry.get('srv__do_thing');

    const resolver = vi.fn(async () => 'deny' as const);
    const res = await runTool(tool, {}, ctx, resolver);
    expect(res.asked).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    expect(res.outcome.ok).toBe(true);
  });

  it('未批准的工具在注册表里查不到 → 连询问的机会都没有', async () => {
    const registry = new ToolRegistry();
    const runtime = fakeRuntime(async () => ({ ok: true, text: '' }));
    registerMcpTools(registry, [profile()], approval(['别的工具']), runtime);
    expect(() => registry.get('srv__do_thing')).toThrow(/未注册的工具/);
  });
});
