/**
 * MCP 客户端核心（W10b）—— **传输无关**，因此可单测。
 *
 * 设计要点：
 * 1. **传输抽象**（`McpTransport`）：核心只管"发一行 JSON-RPC、收一行响应"，
 *    具体的子进程 stdio / 未来可能的 HTTP 由外部实现。这样测试用一个**假传输**
 *    就能完整验证握手、并发请求、超时、错误与清理，**不需要真的起 MCP 服务端**。
 * 2. **请求-响应按 id 关联**：允许并发请求，各自独立超时；未匹配的响应被忽略并记录。
 * 3. **生命周期明确**：`dispose()` 必须清空所有挂起的请求（否则调用方会永久 await）。
 * 4. 权限分级**不在这里判断** —— 它属于工具注册与权限门（见 mcp.ts 的 inferToolKind）。
 */

import {
  buildInitialize,
  buildToolsCall,
  buildToolsList,
  parseMessage,
  parseToolList,
  toToolProfiles,
  type McpToolProfile,
} from './mcp';

/** 传输抽象：把"发一行 / 收一行"与具体实现解耦 */
export interface McpTransport {
  /** 发送一行（不含换行符由实现补） */
  send: (line: string) => void;
  /** 注册"收到一行"的回调；返回取消注册函数 */
  onLine: (handler: (line: string) => void) => () => void;
  /** 释放资源（杀子进程 / 关连接） */
  dispose: () => void;
}

export interface McpClientOptions {
  /** 单次请求超时（毫秒） */
  requestTimeoutMs?: number;
  /** 诊断日志回调（不抛异常，仅记录） */
  onDebug?: (message: string) => void;
}

export interface ToolCallOutcome {
  ok: boolean;
  /** 成功时的原始结果 */
  result?: unknown;
  /** 失败原因（协议错误 / 超时 / 服务端错误 / 工具自述失败） */
  error?: string;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpClient {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  /** 握手后服务端报告的协议版本（可能与我们发起的不同，以服务端为准） */
  private serverInfo: { name?: string; version?: string; protocolVersion?: string } = {};

  constructor(
    private readonly transport: McpTransport,
    private readonly options: McpClientOptions = {},
  ) {
    // **构造时就监听**，而不是等 connect()。
    // 原因（由并发测试暴露）：若调用方不经 connect() 直接发请求，响应会无人处理，
    // 一直挂到超时。提前监听对未匹配的 id 是无害的（会被忽略并记日志）。
    this.attach();
  }

  private get timeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private debug(message: string): void {
    this.options.onDebug?.(message);
  }

  /** 开始监听；重复调用无副作用 */
  private attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.onLine((line) => this.handleLine(line));
  }

  /** 处理一行输入：只消费响应，忽略通知与非法行 */
  private handleLine(line: string): void {
    const parsed = parseMessage(line);
    if (parsed.type === 'invalid') {
      // 外部进程常混入日志/调试输出：记日志跳过，绝不让它影响请求流程
      this.debug(`忽略非响应报文：${parsed.reason}`);
      return;
    }
    const msg = parsed.value;
    const entry = this.pending.get(msg.id);
    if (!entry) {
      this.debug(`收到无对应请求的响应 id=${msg.id}（可能已超时）`);
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    if ('error' in msg) {
      entry.reject(new Error(`服务端错误 ${msg.error.code}：${msg.error.message}`));
    } else {
      entry.resolve(msg.result);
    }
  }

  /**
   * 通用请求原语：发一条 JSON-RPC 请求并等它的响应。
   *
   * 公开的理由：MCP 除 `tools/*` 外还有 `resources/*`、`prompts/*` 等方法，
   * 后续接入时不该再复制一遍 id 关联与超时逻辑。
   */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('客户端已释放'));
    const id = this.nextId++;
    const req =
      params === undefined
        ? ({ jsonrpc: '2.0', id, method } as const)
        : ({ jsonrpc: '2.0', id, method, params } as const);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求超时（${this.timeoutMs}ms）：${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(JSON.stringify(req));
    });
  }

  /**
   * 握手：发送 `initialize`。
   * 以**服务端的协议版本**为准（服务端可能降级到它支持的版本），并记录服务端信息。
   *
   * 注：监听在构造时已建立，这里无需再 attach（重复调用 attach 也无副作用）。
   */
  async connect(): Promise<{ name?: string; version?: string; protocolVersion?: string }> {
    this.attach();
    const result = await this.request('initialize', buildInitialize(1).params);
    const r = (result ?? {}) as Record<string, unknown>;
    const info = (r['serverInfo'] ?? {}) as Record<string, unknown>;
    this.serverInfo = {
      ...(typeof info['name'] === 'string' ? { name: info['name'] } : {}),
      ...(typeof info['version'] === 'string' ? { version: info['version'] } : {}),
      ...(typeof r['protocolVersion'] === 'string' ? { protocolVersion: r['protocolVersion'] } : {}),
    };
    return this.serverInfo;
  }

  /** 握手结果（未握手时为空对象） */
  get server(): { name?: string; version?: string; protocolVersion?: string } {
    return this.serverInfo;
  }

  /** 列出工具并转成内部档案（含权限分级与理由） */
  async listTools(): Promise<McpToolProfile[]> {
    const result = await this.request('tools/list', buildToolsList(1).params);
    return toToolProfiles(this.serverInfo.name ?? 'mcp', parseToolList(result));
  }

  /**
   * 调用工具。
   *
   * 两类失败要分开如实上报（不混成一个"失败"）：
   * - **协议层失败**（超时 / 服务端错误）→ 返回 `error`
   * - **工具自述失败**（MCP 结果里 `isError: true`）→ 也返回 `error`，但带服务端给的正文
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    let result: unknown;
    try {
      result = await this.request('tools/call', buildToolsCall(1, name, args).params);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const r = (result ?? {}) as Record<string, unknown>;
    const isError = r['isError'] === true;
    const text = extractText(r['content']);
    if (isError) {
      return { ok: false, result, error: text === '' ? '工具自述执行失败' : text };
    }
    return { ok: true, result };
  }

  /** 释放：清空挂起请求（避免调用方永久 await）+ 释放传输 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('客户端已释放，请求被取消'));
    }
    this.pending.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      this.transport.dispose();
    } catch (err) {
      this.debug(`释放传输时报错（已忽略）：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 当前挂起请求数（供诊断与测试断言，不暴露内部结构） */
  get pendingCount(): number {
    return this.pending.size;
  }
}

/** 从 MCP 的 content 数组里取纯文本（容错：非标准结构返回空串） */
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === 'object' && item !== null) {
      const t = (item as Record<string, unknown>)['text'];
      if (typeof t === 'string') parts.push(t);
    }
  }
  return parts.join('\n');
}
