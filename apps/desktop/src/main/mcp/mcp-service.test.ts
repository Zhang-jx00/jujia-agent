import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, runTool, type McpTransport, type StoredTool } from '@jujia/agent-core';
import { McpService, type ExternalMcpServer, type McpExitInfo, type McpTransportHooks } from './mcp-service';
import { createMemoryMcpStore } from './mcp-store';

/* ------------------------------------------------------------------ *
 * 假传输：直接扮演一个 MCP 服务端（按 method 回应），
 * 因此可以在毫秒级内把「握手失败 / 挂死 / 进程退出」这些真实但难复现的场景跑全。
 * ------------------------------------------------------------------ */

interface FakeScript {
  serverName?: string;
  tools?: Array<Record<string, unknown>>;
  /** 不回应任何请求，模拟挂死 */
  silent?: boolean;
  /** initialize 回一个 JSON-RPC error */
  failHandshake?: boolean;
  /** tools/call 回 isError: true */
  callFails?: boolean;
  /** **只**对 tools/call 不回话：进程还在、就是不应声（外部审查 T31 的"僵而不退"） */
  ignoreCall?: boolean;
  /** tools/call 回一个 JSON-RPC error：服务端答了，只是答的是错误 */
  callProtocolError?: boolean;
  onCall?: (name: string, args: Record<string, unknown>) => void;
}

class FakeTransport implements McpTransport {
  readonly sent: string[] = [];
  disposed = false;
  private readonly handlers = new Set<(line: string) => void>();

  constructor(
    private readonly script: FakeScript,
    private readonly hooks: McpTransportHooks,
  ) {}

  send(line: string): void {
    if (this.disposed || this.script.silent === true) return;
    this.sent.push(line);
    const msg = JSON.parse(line) as { id: number; method: string };
    if (msg.method === 'initialize') {
      if (this.script.failHandshake === true) {
        this.replyError(msg.id, '初始化被拒绝');
        return;
      }
      this.reply(msg.id, {
        protocolVersion: '2025-06-18',
        serverInfo: { name: this.script.serverName ?? 'fake', version: '1.0.0' },
      });
      return;
    }
    if (msg.method === 'tools/list') {
      this.reply(msg.id, { tools: this.script.tools ?? [] });
      return;
    }
    if (msg.method === 'tools/call') {
      // 请求照发照记（sent 里看得见它确实被送到过远端），但**不回话**
      if (this.script.ignoreCall === true) return;
      const params = (JSON.parse(line) as { params: { name: string; arguments: Record<string, unknown> } })
        .params;
      this.script.onCall?.(params.name, params.arguments);
      if (this.script.callProtocolError === true) {
        this.replyError(msg.id, '服务端内部故障');
        return;
      }
      if (this.script.callFails === true) {
        this.reply(msg.id, { isError: true, content: [{ type: 'text', text: '远端报错' }] });
        return;
      }
      this.reply(msg.id, { content: [{ type: 'text', text: `echo:${params.name}` }] });
      return;
    }
  }

  private reply(id: number, result: unknown): void {
    queueMicrotask(() => this.emit(JSON.stringify({ jsonrpc: '2.0', id, result })));
  }
  private replyError(id: number, message: string): void {
    queueMicrotask(() => this.emit(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })));
  }
  private emit(line: string): void {
    for (const h of this.handlers) h(line);
  }

  onLine(handler: (line: string) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  dispose(): void {
    this.disposed = true;
  }

  /** 模拟子进程退出（真实实现里由 stdio-transport 的 onExit 触发） */
  exit(info: McpExitInfo): void {
    this.hooks.onExit(info);
  }
}

const TOOLS = [
  { name: 'read_thing', description: '读点东西', annotations: { readOnlyHint: true } },
  { name: 'do_thing', description: '干点事' },
];

/** 一个最小可用的工具定义，用来占住工具名（验证"重名会被跳过而不是覆盖"） */
function stubTool(name: string): StoredTool {
  return {
    name,
    description: '占位工具',
    kind: 'read',
    parameters: { type: 'object', properties: {} },
    parse: (raw: unknown) => raw,
    run: async () => ({ ok: true, content: '' }),
  };
}

function setup(
  script: FakeScript = {},
  opts: {
    requestTimeoutMs?: number;
    initializeTimeoutMs?: number;
    externalServers?: ExternalMcpServer[];
  } = {},
) {
  const registry = new ToolRegistry();
  const transports: FakeTransport[] = [];
  const service = new McpService({
    registry,
    store: createMemoryMcpStore(),
    createTransport: (_config, hooks) => {
      const t = new FakeTransport(script, hooks);
      transports.push(t);
      return t;
    },
    requestTimeoutMs: opts.requestTimeoutMs ?? 500,
    initializeTimeoutMs: opts.initializeTimeoutMs ?? 1000,
    ...(opts.externalServers ? { externalServers: () => opts.externalServers! } : {}),
  });
  return {
    service,
    registry,
    transports,
    last: (): FakeTransport => {
      const t = transports[transports.length - 1];
      if (!t) throw new Error('还没有创建过传输');
      return t;
    },
  };
}

const SERVER = {
  name: '测试服务端',
  command: 'npx',
  args: ['-y', 'demo-mcp'],
  env: {},
};

/** 建一个服务端并连接，返回它拿到的批准计划 */
async function connectFresh(
  script: FakeScript = {},
  opts: {
    requestTimeoutMs?: number;
    initializeTimeoutMs?: number;
    externalServers?: ExternalMcpServer[];
  } = {},
) {
  const ctx = setup(script, opts);
  const view = await ctx.service.save(SERVER);
  const result = await ctx.service.connect(view.id);
  return { ...ctx, id: view.id, result };
}

/* ------------------------------------------------------------------ */

describe('配置（save / views / remove）', () => {
  it('新增后出现在列表里，且 env 只给键名不给值', async () => {
    const ctx = setup();
    const view = await ctx.service.save({
      ...SERVER,
      env: { FOO: 'bar', SOME_TOKEN: '超机密' },
    });
    expect(view.envKeys.sort()).toEqual(['FOO', 'SOME_TOKEN']);
    // 整个视图对象里不得出现任何 env 的**值**
    expect(JSON.stringify(view)).not.toContain('超机密');
    expect(JSON.stringify(view)).not.toContain('bar');
  });

  it('含 shell 元字符的命令被拒绝，且不落盘', async () => {
    const ctx = setup();
    await expect(
      ctx.service.save({ ...SERVER, command: 'npx && rm -rf /' }),
    ).rejects.toThrow(/被拒绝/);
    expect(await ctx.service.views()).toEqual([]);
  });

  it('args 里的 shell 元字符同样被拒绝', async () => {
    const ctx = setup();
    await expect(
      ctx.service.save({ ...SERVER, args: ['-y', 'pkg | cat /etc/passwd'] }),
    ).rejects.toThrow(/被拒绝/);
  });

  it('未连接时 state 为 idle，lastError 为 null', async () => {
    const ctx = setup();
    const view = await ctx.service.save(SERVER);
    expect(view.state).toBe('idle');
    expect(view.lastError).toBeNull();
    expect(view.enabledTools).toEqual([]);
  });

  it('改动命令会**先断开旧连接**（旧进程跑的已经不是这份配置）', async () => {
    const { service, registry, id, transports } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    expect(registry.has('srv-1__do_thing')).toBe(true);

    // 只改命令 → 必须断开
    const view = await service.save({ id, ...SERVER, command: 'node' });
    expect(view.state).toBe('idle');
    expect(registry.has('srv-1__do_thing')).toBe(false);
    expect(transports[0]?.disposed).toBe(true);
  });

  it('只改名字**不**断开（进程没变，没必要打断用户）', async () => {
    const { service, registry, id } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    const view = await service.save({ id, ...SERVER, name: '改了名字' });
    expect(view.state).toBe('connected');
    expect(registry.has('srv-1__do_thing')).toBe(true);
  });

  it('删除会先断开再删；删不存在的返回 false', async () => {
    const { service, registry, id } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    expect(await service.remove(id)).toBe(true);
    expect(registry.all()).toHaveLength(0);
    expect(await service.remove(id)).toBe(false);
    expect(await service.views()).toEqual([]);
  });

  it('更新时**省略 env** = 保持原有环境变量（值不回传界面，强制传会静默清空）', async () => {
    const ctx = setup();
    const created = await ctx.service.save({
      ...SERVER,
      env: { FOO: 'bar', BAZ: 'qux' },
    });
    expect(created.envKeys.sort()).toEqual(['BAZ', 'FOO']);

    // 只改名字，**不带 env**（界面就是这么做的：用户没动那一段）
    const updated = await ctx.service.save({
      id: created.id,
      name: '改了名字',
      command: SERVER.command,
      args: SERVER.args,
    });
    expect(updated.envKeys.sort()).toEqual(['BAZ', 'FOO']);

    // 显式传空对象才是清空
    const cleared = await ctx.service.save({
      id: created.id,
      name: '改了名字',
      command: SERVER.command,
      args: SERVER.args,
      env: {},
    });
    expect(cleared.envKeys).toEqual([]);
  });

  it('env 的值从不回传到视图（只给键名）', async () => {
    const ctx = setup();
    const view = await ctx.service.save({ ...SERVER, env: { SECRET_TOKEN: '绝密' } });
    expect(view.envKeys).toEqual(['SECRET_TOKEN']);
    expect(JSON.stringify(view)).not.toContain('绝密');
    expect(JSON.stringify(await ctx.service.views())).not.toContain('绝密');
  });
});

/**
 * 待批准计划的**归属**（外部审查 T9）：它一直是主进程的事实，
 * 以前只是从没被再读一次 —— 界面把它当组件 state 存，切个页签就没了，
 * 用户只能重新点一次「连接」（那会真的再起一个第三方进程）。
 */
describe('待批准计划读得回来（切页签不该丢）', () => {
  it('连接之后 pendingApproval() 给得出计划；批准做完就不再有挂着的计划', async () => {
    const { service } = await connectFresh({ tools: TOOLS });
    const pending = service.pendingApproval();
    expect(pending?.id).toBeTruthy();
    expect(pending?.plan.toolCount).toBe(2);
    await service.approve(pending?.id ?? '', { action: 'approve_all' });
    // 批过了还"待批准"，界面就会反复恢复一个已经做完的弹窗
    expect(service.pendingApproval()).toBeNull();
  });

  it('拒绝同样清空计划（拒绝之后没有东西可批）', async () => {
    const { service } = await connectFresh({ tools: TOOLS });
    const pending = service.pendingApproval();
    await service.approve(pending?.id ?? '', { action: 'deny' });
    expect(service.pendingApproval()).toBeNull();
  });

  it('界面在刷新时真的去主进程读一次（不是只信自己那份 state）', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const panel = readFileSync(
      join(here, '..', '..', 'renderer', 'src', 'features', 'mcp', 'McpPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('window.jujia.mcpPendingPlan()');
  });
});

describe('连接（connect）', () => {
  it('握手 + 列工具成功 → 返回待批准计划，状态为 awaiting_approval', async () => {
    const { service, result, registry } = await connectFresh({ tools: TOOLS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.toolCount).toBe(2);
    expect(result.plan.readOnlyCount).toBe(1);
    expect(result.plan.alwaysAskCount).toBe(1);
    expect(result.plan.serverName).toBe('测试服务端');
    // 关键：**还没批准之前，不得有任何工具进注册表**
    expect(registry.all()).toHaveLength(0);
    expect((await service.views())[0]?.state).toBe('awaiting_approval');
  });

  it('计划里逐字展示将执行的命令（含平台适配）', async () => {
    const { result } = await connectFresh({ tools: TOOLS });
    expect(result.ok && result.plan.commandLine).toContain('npx');
    expect(result.ok && result.plan.commandLine).toContain('demo-mcp');
  });

  it('服务端挂死（不回应）→ 返回失败、状态 error，且**进程被真的退掉**', async () => {
    const { service, id, result, transports } = await connectFresh({ silent: true }, { requestTimeoutMs: 200, initializeTimeoutMs: 200 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('超时');
    const view = (await service.views())[0];
    expect(view?.state).toBe('error');
    expect(view?.lastError).toContain('超时');
    // 不能留一个连不上的第三方进程在跑
    expect(transports[0]?.disposed).toBe(true);
    expect(id).toBeTruthy();
  });

  it('服务端在 initialize 阶段就报错 → 同样退掉进程并如实上报', async () => {
    const { service, result, transports } = await connectFresh({ failHandshake: true });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('初始化被拒绝');
    expect(transports[0]?.disposed).toBe(true);
    expect((await service.views())[0]?.state).toBe('error');
  });

  it('连接不存在的服务端 → 抛错，不静默返回成功', async () => {
    const ctx = setup();
    await expect(ctx.service.connect('不存在')).rejects.toThrow(/不存在/);
  });

  it('重复连接会先把旧连接彻底断掉（不会出现两个进程或重名注册）', async () => {
    const { service, id, transports } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    const again = await service.connect(id);
    expect(again.ok).toBe(true);
    expect(transports).toHaveLength(2);
    expect(transports[0]?.disposed).toBe(true);
    expect(transports[1]?.disposed).toBe(false);
  });
});

describe('批准（approve）', () => {
  it('全部批准 → 工具进注册表，状态 connected', async () => {
    const { service, registry, id } = await connectFresh({ tools: TOOLS });
    const out = await service.approve(id, { action: 'approve_all' });
    expect(out.approved).toBe(true);
    expect(out.registered.sort()).toEqual(['srv-1__do_thing', 'srv-1__read_thing']);
    expect(registry.names().sort()).toEqual(['srv-1__do_thing', 'srv-1__read_thing']);
    expect((await service.views())[0]?.state).toBe('connected');
  });

  it('**拒绝 → 零工具可用，而且进程被真的退掉**', async () => {
    const { service, registry, id, transports } = await connectFresh({ tools: TOOLS });
    const out = await service.approve(id, { action: 'deny' });
    expect(out.approved).toBe(false);
    expect(out.registered).toEqual([]);
    expect(registry.all()).toHaveLength(0);
    // 拒绝的语义包含"不留下一个被拒绝的第三方进程在后台跑"
    expect(transports[0]?.disposed).toBe(true);
    expect((await service.views())[0]?.state).toBe('idle');
  });

  it('部分批准 → 未启用的彻底不可用（注册表里查不到）', async () => {
    const { service, registry, id } = await connectFresh({ tools: TOOLS });
    const out = await service.approve(id, {
      action: 'approve_partial',
      toolNames: ['srv-1__do_thing'],
    });
    expect(out.enabledTools).toEqual(['srv-1__do_thing']);
    expect(registry.has('srv-1__do_thing')).toBe(true);
    expect(registry.has('srv-1__read_thing')).toBe(false);
    expect(() => registry.get('srv-1__read_thing')).toThrow(/未注册/);
  });

  it('批准了不存在的工具名 → 被忽略并如实记录跳过原因', async () => {
    const { service, registry, id } = await connectFresh({ tools: TOOLS });
    const out = await service.approve(id, {
      action: 'approve_partial',
      toolNames: ['srv-1__do_thing', '并不存在'],
    });
    expect(out.enabledTools).toEqual(['srv-1__do_thing']);
    expect(registry.has('并不存在')).toBe(false);
  });

  it('部分批准但一个都不在名单里 → 视为未批准，进程被退掉', async () => {
    const { service, registry, id, transports } = await connectFresh({ tools: TOOLS });
    const out = await service.approve(id, { action: 'approve_partial', toolNames: ['查无此工具'] });
    expect(out.approved).toBe(false);
    expect(registry.all()).toHaveLength(0);
    expect(transports[0]?.disposed).toBe(true);
  });

  it('没有待批准请求时调用 approve → 抛错（不做无依据的批准）', async () => {
    const ctx = setup();
    const view = await ctx.service.save(SERVER);
    await expect(ctx.service.approve(view.id, { action: 'approve_all' })).rejects.toThrow(/没有待批准/);
  });

  it('批准选择本身必须过契约校验（乱传会被拒）', async () => {
    const { service, id } = await connectFresh({ tools: TOOLS });
    await expect(service.approve(id, { action: '随便批' })).rejects.toThrow();
  });

  it('批准了但一个都注册不上（全部与已有工具重名）→ 如实报错，不假装已连接', async () => {
    const ctx = setup({ tools: TOOLS });
    // 先把两个同名工具占住位置：注册表对重名是**拒绝而不是覆盖**，因此这两个都会失败
    ctx.registry.register(stubTool('srv-1__do_thing'));
    ctx.registry.register(stubTool('srv-1__read_thing'));

    const view = await ctx.service.save(SERVER);
    await ctx.service.connect(view.id);
    const out = await ctx.service.approve(view.id, { action: 'approve_all' });

    expect(out.approved).toBe(true); // 用户确实批准了
    expect(out.enabledTools).toEqual([]); // 但实际一个都不可用
    expect(out.registered).toEqual([]);
    expect(out.note).toContain('没有任何工具注册成功');
    expect(out.skipped).toHaveLength(2);
    expect(out.skipped[0]?.reason).toContain('同名');
    // 状态必须是 error：否则 UI 会显示"已连接"，而用户会发现根本没有可用工具
    expect((await ctx.service.views())[0]?.state).toBe('error');
    // 已有的那两个（stub）不能被顺手摘掉 —— 我们只摘自己注册的
    expect(ctx.registry.names()).toHaveLength(2);
  });
});

describe('工具调用（callTool）', () => {
  it('已批准的工具有效：调用会打到远端并把文本回传', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const { service, id } = await connectFresh({
      tools: TOOLS,
      onCall: (name, args) => calls.push({ name, args }),
    });
    await service.approve(id, { action: 'approve_all' });

    const out = await service.callTool('srv-1__do_thing', { q: 1 });
    expect(out.ok).toBe(true);
    expect(out.text).toBe('echo:do_thing');
    // 发给远端的必须是**原始工具名**，不是加了前缀的模型侧名字
    expect(calls).toEqual([{ name: 'do_thing', args: { q: 1 } }]);
  });

  it('未批准的工具即使传对名字也直接拒绝（第二道防线）', async () => {
    const calls: string[] = [];
    const { service, id } = await connectFresh({ tools: TOOLS, onCall: (n) => calls.push(n) });
    await service.approve(id, { action: 'approve_partial', toolNames: ['srv-1__do_thing'] });

    const out = await service.callTool('srv-1__read_thing', {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain('未被批准');
    expect(calls).toEqual([]); // 远端根本没被碰
  });

  it('找不到归属服务端 → 报错，绝不挑一个相近的试', async () => {
    const { service, id, transports } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    const before = transports[0]?.sent.length ?? 0;

    const out = await service.callTool('别的服务端__do_thing', {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain('没有任何已连接的服务端');
    expect(transports[0]?.sent.length).toBe(before); // 没有凭空发请求出去
  });

  it('远端自述失败 → 如实回传失败原因', async () => {
    const { service, id } = await connectFresh({ tools: TOOLS, callFails: true });
    await service.approve(id, { action: 'approve_all' });
    const out = await service.callTool('srv-1__do_thing', {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain('远端报错');
  });

  it('断开后调用 → 报错（工具已不在任何会话里）', async () => {
    const { service, id } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    await service.disconnect(id);
    const out = await service.callTool('srv-1__do_thing', {});
    expect(out.ok).toBe(false);
  });

  /* ---------------- T31：状态诚实化（僵而不退要说出来） ---------------- */

  it('服务端收了请求却不应声 → 这次失败要**写回状态**，界面不能再是"已连接"', async () => {
    const { service, id, registry } = await connectFresh(
      { tools: TOOLS, ignoreCall: true },
      { requestTimeoutMs: 120 },
    );
    await service.approve(id, { action: 'approve_all' });
    expect((await service.views())[0]?.state).toBe('connected');

    const out = await service.callTool('srv-1__do_thing', {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain('超时');

    const view = (await service.views())[0];
    expect(view?.state).toBe('error');
    expect(view?.lastError).toContain('超时');
    // **进程还在**，所以工具不摘：它们要以"不可用 + 为什么"的样子出现，
    // 而不是像进程退出那样莫名消失（那会让模型以为"这个能力没了"，实际是服务端卡住了）
    expect(registry.has('srv-1__do_thing')).toBe(true);
    expect(view?.enabledTools.slice().sort()).toEqual(['srv-1__do_thing', 'srv-1__read_thing']);
  });

  it('第二次调用**立刻**失败：不再让模型重付一次超时，而且一条请求都没再发出去', async () => {
    const { service, id, transports } = await connectFresh(
      { tools: TOOLS, ignoreCall: true },
      { requestTimeoutMs: 120 },
    );
    await service.approve(id, { action: 'approve_all' });
    await service.callTool('srv-1__do_thing', {});
    const sent = transports[0]?.sent.length ?? 0;

    const again = await service.callTool('srv-1__read_thing', {});
    expect(again.ok).toBe(false);
    // 拒绝的理由要带上"为什么不可用"，只说"不可用"等于让人自己去猜
    expect(again.text).toContain('不可用');
    expect(again.text).toContain('超时');
    expect(transports[0]?.sent.length).toBe(sent);
  });

  it('状态写回要广播出去（不广播 = 界面停在假话上）', async () => {
    const { service, id } = await connectFresh({ tools: TOOLS, ignoreCall: true }, { requestTimeoutMs: 120 });
    await service.approve(id, { action: 'approve_all' });
    const seen: string[] = [];
    service.onChanged((views) => seen.push(views[0]?.state ?? '无'));

    await service.callTool('srv-1__do_thing', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toContain('error');
  });

  it('工具自述失败 ≠ 服务端坏了：状态仍是 connected，但原因要记下来', async () => {
    const { service, id } = await connectFresh({ tools: TOOLS, callFails: true });
    await service.approve(id, { action: 'approve_all' });
    const out = await service.callTool('srv-1__do_thing', {});

    expect(out.ok).toBe(false);
    expect(out.text).toContain('远端报错');
    expect((await service.views())[0]?.state).toBe('connected');
    expect((await service.views())[0]?.lastError).toContain('远端报错');
  });

  it('服务端回了 JSON-RPC 错误（它还在说话）→ 只记原因，不谎报"连不上"', async () => {
    const { service, id } = await connectFresh(
      { tools: TOOLS, callProtocolError: true },
      { requestTimeoutMs: 3_000 },
    );
    await service.approve(id, { action: 'approve_all' });
    const out = await service.callTool('srv-1__do_thing', {});

    expect(out.ok).toBe(false);
    expect(out.text).toContain('服务端内部故障');
    expect((await service.views())[0]?.state).toBe('connected');
    expect((await service.views())[0]?.lastError).toContain('服务端内部故障');
  });

  it('进程已退出之后，在途请求那条超时不许把状态从 exited 改成 error', async () => {
    const { service, id, last } = await connectFresh(
      { tools: TOOLS, ignoreCall: true },
      { requestTimeoutMs: 200 },
    );
    await service.approve(id, { action: 'approve_all' });

    const inFlight = service.callTool('srv-1__do_thing', {});
    last().exit({ code: 7, signal: null }); // 进程先没了：这才是事实
    const out = await inFlight; // 那条请求此刻才超时返回
    expect(out.ok).toBe(false);

    const view = (await service.views())[0];
    expect(view?.state).toBe('exited');
    // 退出原因不能被"请求超时"盖掉：用户要看的是 code=7，不是它的后果
    expect(view?.lastError).toContain('code=7');
  });

  it('界面那一行确实会带 lastError（状态写回不等于用户看得见，接线要钉住）', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const panel = readFileSync(
      join(here, '..', '..', 'renderer', 'src', 'features', 'mcp', 'McpPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain("{s.lastError ? ` · ${s.lastError}` : ''}");
  });
});

describe('子进程退出与并发（含 generation 守卫）', () => {
  it('进程意外退出 → 状态 exited 且**工具立刻被摘掉**（不留"看起来可用"的工具）', async () => {
    const { service, registry, id, last } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    expect(registry.all()).toHaveLength(2);

    last().exit({ code: 3, signal: null });

    const view = (await service.views())[0];
    expect(view?.state).toBe('exited');
    expect(view?.lastError).toContain('code=3');
    expect(view?.enabledTools).toEqual([]);
    expect(registry.all()).toHaveLength(0);
  });

  it('spawn 失败（命令不存在）→ 状态 exited 并带上 spawnError', async () => {
    const { service, id, last } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    last().exit({ code: null, signal: null, spawnError: 'spawn npx ENOENT' });
    expect((await service.views())[0]?.lastError).toContain('ENOENT');
  });

  it('主动断开触发的退出不算异常（不误报"进程意外退出"）', async () => {
    const { service, id, last } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    await service.disconnect(id);
    last().exit({ code: null, signal: 'SIGTERM' }); // 模拟被杀后回调晚到
    const view = (await service.views())[0];
    expect(view?.state).toBe('idle');
    expect(view?.lastError).toBeNull();
  });

  it('**generation 守卫**：旧连接的晚到退出回调不能摘掉新连接的工具', async () => {
    const { service, registry, id, transports } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });

    await service.disconnect(id);
    const again = await service.connect(id);
    expect(again.ok).toBe(true);
    await service.approve(id, { action: 'approve_all' });
    expect(registry.has('srv-1__do_thing')).toBe(true);

    // 旧连接（第一个传输）的退出回调此刻才到
    transports[0]?.exit({ code: 0, signal: null });

    // 新连接必须毫发无伤：状态仍是 connected，工具仍在表里
    // （若没有 generation 守卫，这里会把新注册的工具全摘掉 —— 表面现象是"工具莫名消失"）
    const view = (await service.views())[0];
    expect(view?.state).toBe('connected');
    expect(view?.enabledTools).toHaveLength(2);
    expect(registry.names()).toHaveLength(2);
  });

  it('disconnect 幂等：第二次返回 false', async () => {
    const { service, id } = await connectFresh({ tools: TOOLS });
    expect(await service.disconnect(id)).toBe(true);
    expect(await service.disconnect(id)).toBe(false);
  });

  it('disposeAll 退掉全部会话（应用退出用）', async () => {
    const { service, transports } = await connectFresh({ tools: TOOLS });
    expect(service.disposeAll()).toBe(1);
    expect(transports[0]?.disposed).toBe(true);
    expect(service.disposeAll()).toBe(0);
  });
});

describe('与权限门的接合（本轮验收点）', () => {
  it('注册进来的 MCP 工具走的是同一套权限门：拒绝时远端不被调用', async () => {
    const calls: string[] = [];
    const { service, registry, id } = await connectFresh({ tools: TOOLS, onCall: (n) => calls.push(n) });
    await service.approve(id, { action: 'approve_all' });

    const tool = registry.get('srv-1__do_thing'); // exec 类
    const denied = await runTool(tool, { q: 1 }, { workspaceRoot: 'D:/ws' }, async () => 'deny');
    expect(denied.asked).toBe(true);
    expect(denied.outcome.ok).toBe(false);
    expect(calls).toEqual([]); // 关键：拒绝之后远端一次都没被调用

    const allowed = await runTool(tool, { q: 1 }, { workspaceRoot: 'D:/ws' }, async () => 'allow_once');
    expect(allowed.outcome.ok).toBe(true);
    expect(calls).toEqual(['do_thing']);
  });

  it('服务端声明只读的工具不打扰用户（不询问直接调用）', async () => {
    const { service, registry, id } = await connectFresh({ tools: TOOLS });
    await service.approve(id, { action: 'approve_all' });
    const tool = registry.get('srv-1__read_thing');
    const resolver = vi.fn(async () => 'deny' as const);
    const res = await runTool(tool, {}, { workspaceRoot: 'D:/ws' }, resolver);
    expect(res.asked).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    expect(res.outcome.ok).toBe(true);
  });
});

describe('状态广播', () => {
  it('注册回调后，连接与批准都会推送最新视图（含进程退出）', async () => {
    const { service, id, last } = await connectFresh({ tools: TOOLS });
    const seen: string[] = [];
    service.onChanged((views) => seen.push(views[0]?.state ?? '无'));

    await service.approve(id, { action: 'approve_all' });
    await new Promise((r) => setTimeout(r, 0));
    last().exit({ code: 1, signal: null });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toContain('connected');
    expect(seen).toContain('exited');
  });
});

describe('插件带来的 MCP 服务端（W11c）', () => {
  /** 一个外部服务端：走与用户配置完全相同的连接/批准流程 */
  const external = (over: Partial<ExternalMcpServer> = {}): ExternalMcpServer => ({
    id: 'plugin:my-team:files',
    name: 'my-team 文件服务',
    pluginName: 'my-team',
    config: { id: 'plugin:my-team:files', name: 'my-team 文件服务', command: 'node', args: [] },
    disabledByPlugin: false,
    ...over,
  });

  it('出现在列表里，且标明来自插件', async () => {
    const ctx = setup({}, { externalServers: [external()] });
    const views = await ctx.service.views();
    expect(views).toHaveLength(1);
    expect(views[0]?.source).toBe('plugin');
    expect(views[0]?.pluginName).toBe('my-team');
    expect(views[0]?.disabledByPlugin).toBe(false);
  });

  it('用户配置**不能占用插件命名空间**（`plugin:` 前缀的 id 由插件保留）', async () => {
    const ctx = setup({}, { externalServers: [external()] });
    await expect(
      ctx.service.save({ id: 'plugin:my-team:files', name: '冒名顶替', command: 'node', args: [] }),
    ).rejects.toThrow(/不能在应用里修改/);
    // 且插件的服务端仍然在列表里、来源不变
    const views = await ctx.service.views();
    expect(views).toHaveLength(1);
    expect(views[0]?.source).toBe('plugin');
  });

  it('可以连接、批准并调用（流程与用户配置的服务端完全一致）', async () => {
    const ctx = setup({ tools: TOOLS }, { externalServers: [external()] });
    const result = await ctx.service.connect('plugin:my-team:files');
    expect(result.ok).toBe(true);
    const out = await ctx.service.approve('plugin:my-team:files', { action: 'approve_all' });
    expect(out.registered.length).toBeGreaterThan(0);
    // 批准后的工具真的进了注册表（经同一套权限门）
    expect(ctx.registry.all().length).toBe(out.registered.length);
  });

  it('插件把它标成未启用 → 拒绝连接并说明原因', async () => {
    const ctx = setup({}, { externalServers: [external({ disabledByPlugin: true })] });
    await expect(ctx.service.connect('plugin:my-team:files')).rejects.toThrow(/enabled: false/);
  });

  it('不能在应用里**修改**插件带来的服务端（改了也会被插件更新覆盖）', async () => {
    const ctx = setup({}, { externalServers: [external()] });
    await expect(
      ctx.service.save({ id: 'plugin:my-team:files', name: 'x', command: 'node', args: [] }),
    ).rejects.toThrow(/插件「my-team」/);
  });

  it('不能**删除**插件带来的服务端（断开可以，删除不行）', async () => {
    const ctx = setup({}, { externalServers: [external()] });
    await expect(ctx.service.remove('plugin:my-team:files')).rejects.toThrow(/不能在应用里删除/);
  });

  it('断开插件服务端是允许的（断开 ≠ 删除）', async () => {
    const ctx = setup({ tools: TOOLS }, { externalServers: [external()] });
    await ctx.service.connect('plugin:my-team:files');
    expect(await ctx.service.disconnect('plugin:my-team:files')).toBe(true);
  });
});
