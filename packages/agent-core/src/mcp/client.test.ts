import { describe, expect, it, vi } from 'vitest';
import { extractText, McpClient, type McpTransport } from './client';
import type { JsonRpcRequest } from './mcp';

/**
 * 用**假传输**驱动客户端：不需要真的起 MCP 服务端，就能完整验证
 * 握手、并发请求、超时、错误上报、脏输入容错与清理。
 *
 * 假服务端可：
 * - 按方法名回包（正常路径）
 * - 回错误包
 * - **不回包**（验证超时）
 * - 往流里**插日志行**（验证容错）
 */

interface FakeServer {
  transport: McpTransport;
  /** 已收到的请求（按顺序） */
  received: JsonRpcRequest[];
  /** 手动推一行给客户端（模拟脏输出） */
  emit: (line: string) => void;
  disposed: boolean;
}

function fakeServer(handler: (req: JsonRpcRequest) => unknown | 'silent'): FakeServer {
  const received: JsonRpcRequest[] = [];
  let handlerRef: ((line: string) => void) | null = null;
  const state: FakeServer = {
    received,
    disposed: false,
    emit: (line) => handlerRef?.(line),
    transport: {
      send: (line) => {
        const req = JSON.parse(line) as JsonRpcRequest;
        received.push(req);
        const out = handler(req);
        if (out === 'silent') return;
        // 异步回包，贴近真实进程时序
        queueMicrotask(() => handlerRef?.(JSON.stringify(out)));
      },
      onLine: (h) => {
        handlerRef = h;
        return () => {
          handlerRef = null;
        };
      },
      dispose: () => {
        state.disposed = true;
      },
    },
  };
  return state;
}

/** 标准 MCP 服务端：支持 initialize / tools/list / tools/call */
function standardHandler(req: JsonRpcRequest): unknown {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'fs', version: '1.2.3' },
      },
    };
  }
  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [
          { name: 'read_file', description: '读文件', annotations: { readOnlyHint: true } },
          { name: 'write_file', description: '写文件' },
        ],
      },
    };
  }
  if (req.method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { content: [{ type: 'text', text: 'ok' }] },
    };
  }
  return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } };
}

describe('McpClient：握手', () => {
  it('发送 initialize 并记录服务端信息与协议版本', async () => {
    const srv = fakeServer(standardHandler);
    const c = new McpClient(srv.transport);
    const info = await c.connect();
    expect(srv.received[0]?.method).toBe('initialize');
    expect(info.name).toBe('fs');
    expect(info.version).toBe('1.2.3');
    expect(info.protocolVersion).toBe('2025-06-18');
    c.dispose();
  });

  it('服务端协议版本与我们不同时，以服务端为准', async () => {
    const srv = fakeServer((req) => ({
      jsonrpc: '2.0',
      id: req.id,
      result: { protocolVersion: '2024-11-05', serverInfo: { name: 'old' } },
    }));
    const c = new McpClient(srv.transport);
    const info = await c.connect();
    expect(info.protocolVersion).toBe('2024-11-05');
    c.dispose();
  });

  it('服务端回错误 → 拒绝并带出错误码与消息', async () => {
    const srv = fakeServer((req) => ({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32000, message: '初始化失败' },
    }));
    const c = new McpClient(srv.transport);
    await expect(c.connect()).rejects.toThrow(/-32000.*初始化失败/);
    c.dispose();
  });
});

describe('McpClient：工具发现', () => {
  it('列出工具并完成权限分级（只读 → read，无注解 → exec）', async () => {
    const srv = fakeServer(standardHandler);
    const c = new McpClient(srv.transport);
    await c.connect();
    const tools = await c.listTools();
    expect(tools.map((t) => t.rawName)).toEqual(['read_file', 'write_file']);
    expect(tools[0]?.kind).toBe('read');
    expect(tools[1]?.kind).toBe('exec');
    c.dispose();
  });

  it('返回结果不是工具数组时得到空列表（不抛异常）', async () => {
    const srv = fakeServer((req) => ({ jsonrpc: '2.0', id: req.id, result: { tools: 'oops' } }));
    const c = new McpClient(srv.transport);
    await c.connect();
    await expect(c.listTools()).resolves.toEqual([]);
    c.dispose();
  });

  it('前缀用调用方给的服务端 id，而不是服务端自报的名字（避免不同配置撞名）', async () => {
    // 场景：同一个 MCP server 用不同参数配置了两份，两份都自报 name='fs'。
    // 若前缀取自报名字，两组工具会撞成同一组 qualifiedName，第二份会被静默跳过。
    const srv = fakeServer(standardHandler);
    const c = new McpClient(srv.transport);
    await c.connect();
    const tools = await c.listTools('srv-1');
    expect(tools.map((t) => t.qualifiedName)).toEqual(['srv-1__read_file', 'srv-1__write_file']);
    c.dispose();
  });
});

describe('McpClient：工具调用', () => {
  it('成功调用返回结果', async () => {
    const srv = fakeServer(standardHandler);
    const c = new McpClient(srv.transport);
    await c.connect();
    const out = await c.callTool('read_file', { path: 'a.txt' });
    expect(out.ok).toBe(true);
    const call = srv.received.find((r) => r.method === 'tools/call');
    expect(call?.params).toEqual({ name: 'read_file', arguments: { path: 'a.txt' } });
    c.dispose();
  });

  it('服务端报错 → ok=false 且带出消息（不与成功混淆）', async () => {
    const srv = fakeServer((req) =>
      req.method === 'tools/call'
        ? { jsonrpc: '2.0', id: req.id, error: { code: -32001, message: '权限不足' } }
        : standardHandler(req),
    );
    const c = new McpClient(srv.transport);
    await c.connect();
    const out = await c.callTool('x', {});
    expect(out.ok).toBe(false);
    expect(out.error).toContain('权限不足');
    // 分类要分清：服务端**答了**，只是答的是错误 → 不能说它僵死（外部审查 T31）
    expect(out.failure).toBe('protocol');
    c.dispose();
  });

  it('工具自述失败（isError:true）→ ok=false 且带服务端正文', async () => {
    const srv = fakeServer((req) =>
      req.method === 'tools/call'
        ? {
            jsonrpc: '2.0',
            id: req.id,
            result: { isError: true, content: [{ type: 'text', text: '文件不存在' }] },
          }
        : standardHandler(req),
    );
    const c = new McpClient(srv.transport);
    await c.connect();
    const out = await c.callTool('read_file', {});
    expect(out.ok).toBe(false);
    expect(out.error).toBe('文件不存在');
    // 工具自己说失败 ≠ 连接坏了：上层不该因此把服务端标成"不可用"
    expect(out.failure).toBe('tool');
    c.dispose();
  });

  it('超时 = 什么响应都没收到 → failure 标 transport（上层据此把状态改诚实）', async () => {
    const srv = fakeServer((req) => (req.method === 'tools/call' ? 'silent' : standardHandler(req)));
    const c = new McpClient(srv.transport, { requestTimeoutMs: 60 });
    await c.connect();
    const out = await c.callTool('read_file', {});
    expect(out.ok).toBe(false);
    expect(out.error).toContain('超时');
    expect(out.failure).toBe('transport');
    // 超时后挂起表必须清空：否则迟到的响应会被当成"下一次请求的回包"
    expect(c.pendingCount).toBe(0);
    c.dispose();
  });
});

describe('McpClient：并发与超时', () => {
  it('并发请求按 id 正确配对，不会串包', async () => {
    // 故意**乱序**回包：先回后发的那个
    const order: JsonRpcRequest[] = [];
    let emitRef: ((l: string) => void) | null = null;
    const transport: McpTransport = {
      send: (line) => {
        const req = JSON.parse(line) as JsonRpcRequest;
        order.push(req);
        if (order.length === 2) {
          // 先回第二个，再回第一个
          queueMicrotask(() => {
            emitRef?.(JSON.stringify({ jsonrpc: '2.0', id: order[1]!.id, result: { tag: 'second' } }));
            emitRef?.(JSON.stringify({ jsonrpc: '2.0', id: order[0]!.id, result: { tag: 'first' } }));
          });
        }
      },
      onLine: (h) => {
        emitRef = h;
        return () => {
          emitRef = null;
        };
      },
      dispose: () => undefined,
    };
    const c = new McpClient(transport);
    const [a, b] = await Promise.all([c.request('m1'), c.request('m2')]);
    expect(a).toEqual({ tag: 'first' });
    expect(b).toEqual({ tag: 'second' });
    c.dispose();
  });

  it('超时的请求被拒绝，且不再占用挂起表', async () => {
    const srv = fakeServer(() => 'silent'); // 永不回包
    const c = new McpClient(srv.transport, { requestTimeoutMs: 30 });
    await expect(c.request('never')).rejects.toThrow(/请求超时/);
    expect(c.pendingCount).toBe(0);
    c.dispose();
  });
});

describe('McpClient：脏输入容错', () => {
  it('日志行 / 半截 JSON / 非 2.0 报文都被忽略，不影响后续请求', async () => {
    const srv = fakeServer(standardHandler);
    const onDebug = vi.fn();
    const c = new McpClient(srv.transport, { onDebug });
    await c.connect();

    srv.emit('Server listening on 3000');
    srv.emit('{"jsonrpc":"2.0","id":');
    srv.emit('{"id":99,"result":{}}');

    // 仍然可以正常调用
    const out = await c.callTool('read_file', {});
    expect(out.ok).toBe(true);
    expect(onDebug).toHaveBeenCalled();
    c.dispose();
  });

  it('收到无对应请求的响应只记日志，不抛异常', async () => {
    const srv = fakeServer(standardHandler);
    const onDebug = vi.fn();
    const c = new McpClient(srv.transport, { onDebug });
    await c.connect();
    srv.emit(JSON.stringify({ jsonrpc: '2.0', id: 99999, result: {} }));
    expect(onDebug).toHaveBeenCalledWith(expect.stringContaining('无对应请求'));
    c.dispose();
  });
});

describe('McpClient：释放', () => {
  it('dispose 会拒绝所有挂起请求（避免调用方永久 await）', async () => {
    const srv = fakeServer(() => 'silent');
    const c = new McpClient(srv.transport, { requestTimeoutMs: 5000 });
    const p = c.request('pending');
    expect(c.pendingCount).toBe(1);
    c.dispose();
    await expect(p).rejects.toThrow(/已释放/);
    expect(c.pendingCount).toBe(0);
  });

  it('dispose 会释放传输，且重复调用无副作用', () => {
    const srv = fakeServer(standardHandler);
    const c = new McpClient(srv.transport);
    c.dispose();
    expect(srv.disposed).toBe(true);
    expect(() => c.dispose()).not.toThrow();
  });

  it('dispose 后新的请求被立即拒绝', async () => {
    const srv = fakeServer(standardHandler);
    const c = new McpClient(srv.transport);
    c.dispose();
    await expect(c.request('x')).rejects.toThrow(/已释放/);
  });
});

describe('extractText', () => {
  it('拼接多个 text 片段', () => {
    expect(extractText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });

  it('非数组 / 非文本项安全返回空串', () => {
    expect(extractText(undefined)).toBe('');
    expect(extractText('nope')).toBe('');
    expect(extractText([{ type: 'image' }, null, 42])).toBe('');
  });
});

describe('握手超时（npx 首跑要下载包，2026-09-22 实测 55.2s）', () => {
  it('initialize 用独立的更长超时：普通请求 50ms 会超时，慢握手在 1s 内仍能等到', async () => {
    const srv = fakeServer((req) =>
      req.method === 'initialize'
        ? 'silent' // 不立即回，由测试手动延迟回包
        : { jsonrpc: '2.0', id: req.id, result: {} },
    );
    const c = new McpClient(srv.transport, { requestTimeoutMs: 50, initializeTimeoutMs: 1000 });
    const connecting = c.connect();

    // 等 80ms（已超过普通超时 50ms，但在握手超时 1s 内）再回包
    await new Promise((r) => setTimeout(r, 80));
    const init = srv.received.find((r) => r.method === 'initialize');
    expect(init).toBeTruthy();
    srv.emit(
      JSON.stringify({
        jsonrpc: '2.0',
        id: init?.id,
        result: { protocolVersion: '2025-06-18', serverInfo: { name: 'slow-npx', version: '1' } },
      }),
    );
    await expect(connecting).resolves.toMatchObject({ name: 'slow-npx' });
    c.dispose();
  });

  it('握手超时的报错带可操作提示（npx 首跑下载 / 重试命中缓存）', async () => {
    const srv = fakeServer(() => 'silent');
    const c = new McpClient(srv.transport, { initializeTimeoutMs: 60 });
    await expect(c.connect()).rejects.toThrow(/下载包/);
    c.dispose();
  });

  it('普通请求的超时报错**不带**握手提示（提示只出现在它该出现的地方）', async () => {
    const srv = fakeServer((req) =>
      req.method === 'initialize'
        ? { jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2025-06-18' } }
        : 'silent',
    );
    const c = new McpClient(srv.transport, { requestTimeoutMs: 50 });
    await c.connect();
    await expect(c.request('tools/list', {})).rejects.toThrow(/^(?!.*下载包).*请求超时/);
    c.dispose();
  });
});
