/**
 * MCP 单测用的**假传输**与脚手架（从 `mcp-service.test.ts` 抽出来的共享件）。
 *
 * 为什么单独成文件：不是"为了好看"，而是 `mcp-service.test.ts` 已经顶到了
 * `max-lines` 800 的上限（超限即报错，逼迫拆分职责 —— 本仓的既定做法是**拆，不放宽**）。
 * 而拆成**新的测试文件**会让 `check-docs` 的「测试文件数」对不上
 * （`docs/PROGRESS.md` 的「当前规模」钉着 146 个）⇒ 那是台账的数字，不归本轮改。
 * 于是把**脚手架**抽到这里：它不是测试文件（不叫 `*.test.ts`），计数不变；
 * 测试文件因此腾出空间装下自动重连那一批用例。
 *
 * 抽出来的这几件东西：
 * - `FakeScript`：这一轮假服务端要演什么戏；
 * - `FakeTransport`：直接扮演一个 MCP 服务端（按 method 回应），
 *   于是可以在毫秒级内把「握手失败 / 挂死 / 进程退出」这些真实但难复现的场景跑全；
 * - `setup` / `connectFresh`：把服务造出来并连上。
 *
 * 它**不引 vitest**（本仓约定：非测试文件不引测试框架）—— 因此它只是个普通模块。
 */

import { ToolRegistry, type McpTransport, type StoredTool } from '@jujia/agent-core';
import { McpService, type ExternalMcpServer, type McpExitInfo, type McpTransportHooks } from '../mcp-service';
import { createMemoryMcpStore } from '../mcp-store';

export interface FakeScript {
  serverName?: string;
  tools?: Array<Record<string, unknown>>;
  /** 不回应任何请求，模拟挂死 */
  silent?: boolean;
  /** initialize 回一个 JSON-RPC error */
  failHandshake?: boolean;
  /**
   * **从第几个传输开始**握手就失败（0 = 第一个就失败）。
   *
   * 为什么需要它：测"自动重连连不上"时，**第一次手动连接必须成功**
   * （否则压根没有"掉线"这回事，也就没有重连），
   * 而**后面几次重连要失败** —— 于是同一个脚本要分出"第几个进程"。
   */
  failHandshakeFrom?: number;
  /**
   * **哪几个传输不应声**（收下请求就是不回话 ⇒ 握手挂着）。
   *
   * 用来造一个"自动重连**正在发起**、握手还没回"的窗口 ——
   * 用户在这个窗口里点「连接」，才能验"用户那条不受影响"。
   */
  silentAt?: number[];
  /** tools/call 回 isError: true */
  callFails?: boolean;
  /** **只**对 tools/call 不回话：进程还在、就是不应声（外部审查 T31 的"僵而不退"） */
  ignoreCall?: boolean;
  /** tools/call 回一个 JSON-RPC error：服务端答了，只是答的是错误 */
  callProtocolError?: boolean;
  onCall?: (name: string, args: Record<string, unknown>) => void;
}

export class FakeTransport implements McpTransport {
  readonly sent: string[] = [];
  disposed = false;
  private readonly handlers = new Set<(line: string) => void>();

  constructor(
    private readonly script: FakeScript,
    private readonly hooks: McpTransportHooks,
    /** 这是第几个传输（0 起）—— 让脚本能"前几个正常、后面几个失败" */
    private readonly index = 0,
  ) {}

  send(line: string): void {
    if (this.disposed || this.script.silent === true) return;
    this.sent.push(line);
    // 指定的几个传输：请求照收（sent 里有），但**就是不回话** ⇒ 握手挂着
    if (this.script.silentAt?.includes(this.index) === true) return;
    const msg = JSON.parse(line) as { id: number; method: string };
    if (msg.method === 'initialize') {
      if (
        this.script.failHandshake === true ||
        (this.script.failHandshakeFrom !== undefined && this.index >= this.script.failHandshakeFrom)
      ) {
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

export const TOOLS = [
  { name: 'read_thing', description: '读点东西', annotations: { readOnlyHint: true } },
  { name: 'do_thing', description: '干点事' },
];

export const SERVER = {
  name: '测试服务端',
  command: 'npx',
  args: ['-y', 'demo-mcp'],
  env: {},
};

/** 一个最小可用的工具定义，用来占住工具名（验证"重名会被跳过而不是覆盖"） */
export function stubTool(name: string): StoredTool {
  return {
    name,
    description: '占位工具',
    kind: 'read',
    parameters: { type: 'object', properties: {} },
    parse: (raw: unknown) => raw,
    run: async () => ({ ok: true, content: '' }),
  };
}

export function setup(
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
      const t = new FakeTransport(script, hooks, transports.length);
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

/** 建一个服务端并连接，返回它拿到的批准计划 */
export async function connectFresh(
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
