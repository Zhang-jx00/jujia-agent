/**
 * 端到端异常路径验证（复核 008 第二遍）—— **全部用真实子进程**，不用假流。
 *
 * 为什么单独成文件：`stdio-transport.test.ts` 里的假流能覆盖"逻辑分支"，
 * 但覆盖不了"真实进程行为"——EPIPE、ENOENT、子进程自杀、真实 stderr 洪流、
 * 以及**脏数据能否被服务端耐受**。这几条恰恰是最容易在生产里炸掉主进程的地方。
 *
 * 这里同时把 `McpClient` 接在真实传输上跑，构成端到端断言：
 * 脏数据服务端不会让客户端卡死，合法响应仍能抵达。
 */

import { describe, expect, it } from 'vitest';
import { McpClient } from '@jujia/agent-core';
import { createStdioTransport } from './stdio-transport';

describe('异常路径 ①：命令不存在（ENOENT）', () => {
  it('不抛异常、不崩进程，onExit 报出 spawnError', async () => {
    const exits: Array<{ code: number | null; signal: string | null; spawnError?: string }> = [];
    const transport = createStdioTransport({
      file: 'definitely-not-a-real-command-jujia-xyz',
      args: [],
      onExit: (i) => exits.push(i),
    });

    await new Promise((r) => setTimeout(r, 1_500));

    expect(exits).toHaveLength(1);
    expect(exits[0]?.spawnError).toBeTruthy();
    expect(transport.alive).toBe(false);
    // 死了之后再 write 也不能抛（EPIPE / 已关闭的管道）
    expect(() => transport.send('{"x":1}')).not.toThrow();
    expect(() => transport.dispose()).not.toThrow();
  }, 20_000);
});

describe('异常路径 ②：子进程回一行后自杀', () => {
  const suicide = `
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', (d) => {
      buf += d;
      if (buf.indexOf('\\n') >= 0) {
        process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"bye":true}}\\n');
        setTimeout(() => process.exit(3), 50);
      }
    });
  `;

  it('已收到的行仍被派发；onExit 如实报 code=3；之后写入不抛', async () => {
    const lines: string[] = [];
    const exits: Array<{ code: number | null; signal: string | null; spawnError?: string }> = [];
    const transport = createStdioTransport({
      file: process.execPath,
      args: ['-e', suicide],
      onExit: (i) => exits.push(i),
    });
    transport.onLine((l) => lines.push(l));
    transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'then-die' }));

    const deadline = Date.now() + 10_000;
    while (exits.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

    // 关键：子进程在响应之后才死，已到达的行不能因为"后来死了"而丢失
    expect(lines.some((l) => l.includes('"bye":true'))).toBe(true);
    expect(exits[0]?.code).toBe(3);
    expect(transport.alive).toBe(false);
    // 真实 EPIPE / 管道已关闭的路径：必须不抛
    expect(() => transport.send('{"jsonrpc":"2.0","id":2,"method":"after-death"}')).not.toThrow();
    expect(() => transport.dispose()).not.toThrow();
  }, 20_000);
});

describe('异常路径 ③：脏数据服务端（端到端：真传输 + McpClient）', () => {
  const dirty = `
    process.stdout.write('[boot] listening\\n');
    process.stdout.write('{"half":\\n');
    process.stdout.write('\\n   \\n');
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        // 每条响应前面先来一轮脏数据
        process.stdout.write('[log] handling ' + msg.method + '\\n');
        process.stdout.write('{oops\\n');
        process.stdout.write('["not","an","object"]\\n');
        process.stdout.write('{"jsonrpc":"1.0","id":' + msg.id + ',"result":{}}\\n');
        process.stdout.write('{"jsonrpc":"2.0","id":99999,"result":"无对应请求"}\\n');
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'dirty-server', version: '0.0.1' },
            tools: [{ name: 'echo', description: '回显', inputSchema: { type: 'object', properties: {} } }],
          },
        }) + '\\n');
      }
    });
  `;

  it('握手仍能成功；脏行不影响后续请求与工具发现', async () => {
    const debugs: string[] = [];
    const transport = createStdioTransport({
      file: process.execPath,
      args: ['-e', dirty],
      onDebug: (m) => debugs.push(m),
      onStderr: (m) => debugs.push(`stderr:${m}`),
    });
    const client = new McpClient(transport, { requestTimeoutMs: 8_000, onDebug: (m) => debugs.push(m) });

    try {
      const info = await client.connect();
      expect(info.name).toBe('dirty-server');

      const tools = await client.listTools();
      expect(tools.map((t) => t.rawName)).toContain('echo');
      // 第三方没给注解 → 必须按最严格处理
      expect(tools[0]?.kind).toBe('exec');

      // 脏行确实被识别并跳过（而不是被当成合法响应）
      expect(debugs.filter((d) => d.includes('忽略非响应报文')).length).toBeGreaterThan(0);
      // 无对应 id 的响应被忽略而不是串包
      expect(debugs.filter((d) => d.includes('无对应请求')).length).toBeGreaterThan(0);
    } finally {
      client.dispose();
    }

    expect(client.pendingCount).toBe(0);
  }, 25_000);
});

describe('异常路径 ④：stderr 洪流', () => {
  it('大量日志刷屏不会让主进程崩，也不污染协议通道', async () => {
    const flood = `
      for (let i = 0; i < 2000; i += 1) process.stderr.write('noise ' + i + '\\n');
      process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\\n');
      setTimeout(() => process.exit(0), 200);
    `;
    const stderr: string[] = [];
    const lines: string[] = [];
    const transport = createStdioTransport({
      file: process.execPath,
      args: ['-e', flood],
      onStderr: (t) => stderr.push(t),
    });
    transport.onLine((l) => lines.push(l));

    const deadline = Date.now() + 10_000;
    while (lines.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

    expect(lines).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"ok":true}}']);
    expect(stderr.length).toBeGreaterThan(100);
    transport.dispose();
  }, 20_000);
});
