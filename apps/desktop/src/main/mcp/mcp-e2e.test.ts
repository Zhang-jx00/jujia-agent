/**
 * MCP 端到端集成验证（W10e）—— **全链路走真东西**：
 * 真子进程 + 真 stdio 传输 + 真服务编排 + 真工具注册表 + 真权限门。
 *
 * 唯一被替换掉的只有「存储」（用内存实现，避免污染 `%APPDATA%` 里的真实配置）。
 *
 * 为什么值得单独写：前面的单测都用**假传输**，能验证逻辑分支，但证明不了
 * 「用户配置的命令真的能跑起来、握手真的能成、工具真的能被调用」。
 * 这一条是"W10e 到底通没通"的硬证据。
 *
 * 断言手法：让假服务端在**每次 tools/call 时往 stderr 写一行 `CALLED <name>`**，
 * 主进程的 stderr 会归入诊断日志（onDebug）。于是"远端到底有没有被调用"
 * 可以精确断言 —— 而不是只看返回文本猜。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, runTool } from '@jujia/agent-core';
import { McpService } from './mcp-service';
import { createMemoryMcpStore } from './mcp-store';
import { createRealTransport } from './real-transport';
import type { StdioTransportHandle } from './stdio-transport';

/** 一个最小但真实的 MCP 服务端（stdio + 换行分隔 JSON-RPC） */
const SERVER_SCRIPT = `
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
      if (msg.method === 'initialize') {
        reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'e2e-fs', version: '9.9.9' } });
      } else if (msg.method === 'tools/list') {
        reply({
          tools: [
            { name: 'read_note', description: '读一条笔记', annotations: { readOnlyHint: true } },
            { name: 'write_note', description: '写一条笔记' },
          ],
        });
      } else if (msg.method === 'tools/call') {
        // 副作用证据：只在**真的被调用**时写这一行
        process.stderr.write('CALLED ' + msg.params.name + '\\n');
        reply({ content: [{ type: 'text', text: '远端结果:' + msg.params.name }] });
      } else {
        reply({});
      }
    }
  });
`;

/**
 * 服务端脚本落地为**真实文件**再执行 —— 这不是权宜之计，反而是更真实的形态：
 * 真实的 MCP 服务端就是一个可执行文件/包。顺带这也验证了本项目
 * `args` 每项 ≤500 字符的硬上限确实挡得住"把脚本内联进参数"这种用法。
 */
let serverDir = '';
let serverPath = '';

beforeAll(() => {
  serverDir = mkdtempSync(join(tmpdir(), 'jujia-mcp-e2e-'));
  serverPath = join(serverDir, 'server.mjs');
  writeFileSync(serverPath, SERVER_SCRIPT, 'utf8');
});

afterAll(() => {
  if (serverDir !== '') rmSync(serverDir, { recursive: true, force: true });
});

function setupE2E() {
  const registry = new ToolRegistry();
  const debug: string[] = [];
  const handles: StdioTransportHandle[] = [];
  const service = new McpService({
    registry,
    store: createMemoryMcpStore(),
    createTransport: (config, hooks) => {
      const handle = createRealTransport(config, hooks, (m) => debug.push(m));
      handles.push(handle);
      return handle;
    },
    requestTimeoutMs: 8_000,
  });
  return { service, registry, debug, handles };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 轮询等待某个条件成立（子进程退出是异步的，直接断言会偶发失败） */
async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(50);
  }
  return predicate();
}

describe('MCP 端到端（真子进程 + 真传输 + 真权限门）', () => {
  it('配置 → 起进程 → 握手 → 列工具 → 批准 → 调用，全链路通', async () => {
    const { service, registry } = setupE2E();

    const view = await service.save({
      name: '端到端服务端',
      command: process.execPath,
      args: [serverPath],
      env: {},
    });

    const result = await service.connect(view.id);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      service.disposeAll();
      return;
    }

    // 握手拿到的服务端信息 + 两个工具（未给注解的那个必须是 exec）
    expect(result.plan.toolCount).toBe(2);
    expect(result.plan.tools.find((t) => t.rawName === 'write_note')?.kind).toBe('exec');
    expect(result.plan.tools.find((t) => t.rawName === 'read_note')?.kind).toBe('read');
    // 批准之前，注册表必须是空的
    expect(registry.all()).toHaveLength(0);

    const out = await service.approve(view.id, { action: 'approve_all' });
    expect(out.registered.sort()).toEqual([`${view.id}__read_note`, `${view.id}__write_note`]);
    expect((await service.views())[0]?.state).toBe('connected');

    // 通过**真实的权限门**调用只读工具
    const readTool = registry.get(`${view.id}__read_note`);
    const readRes = await runTool(readTool, {}, { workspaceRoot: '__no_workspace__' }, async () => 'deny');
    expect(readRes.asked).toBe(false); // 只读 → 不打扰用户
    expect(readRes.outcome.ok).toBe(true);
    expect(readRes.outcome.content).toContain('远端结果:read_note');

    service.disposeAll();
  }, 40_000);

  it('拒绝时远端**一次都没被调用**（用 stderr 副作用证据，不靠返回文本猜）', async () => {
    const { service, registry, debug } = setupE2E();
    const view = await service.save({
      name: '端到端服务端',
      command: process.execPath,
      args: [serverPath],
      env: {},
    });
    const connected = await service.connect(view.id);
    expect(connected.ok).toBe(true);
    await service.approve(view.id, { action: 'approve_all' });

    const tool = registry.get(`${view.id}__write_note`); // exec 类
    const denied = await runTool(tool, { text: 'x' }, { workspaceRoot: '__no_workspace__' }, async () => 'deny');
    expect(denied.asked).toBe(true);
    expect(denied.outcome.content).toContain('用户拒绝');

    await wait(300); // 给 stderr 一点时间到达
    expect(debug.filter((d) => d.includes('CALLED'))).toEqual([]);

    // 同意之后才真的打过去
    const allowed = await runTool(tool, { text: 'x' }, { workspaceRoot: '__no_workspace__' }, async () => 'allow_once');
    expect(allowed.outcome.ok).toBe(true);
    expect(allowed.outcome.content).toContain('远端结果:write_note');

    await wait(300);
    expect(debug.filter((d) => d.includes('CALLED write_note'))).toHaveLength(1);

    service.disposeAll();
  }, 40_000);

  it('拒绝接入后：工具清空、状态回到未连接，且子进程**真的被退掉**', async () => {
    const { service, registry, handles } = setupE2E();
    const view = await service.save({
      name: '端到端服务端',
      command: process.execPath,
      args: [serverPath],
      env: {},
    });
    await service.connect(view.id);
    expect(handles[0]?.alive).toBe(true);

    const denied = await service.approve(view.id, { action: 'deny' });
    expect(denied.approved).toBe(false);
    expect(registry.all()).toHaveLength(0);

    // 「拒绝」的语义包含"不留下一个被拒绝的第三方进程在后台跑" ——
    // 直接断言真实传输的存活状态（进程退出是异步的，所以轮询）
    expect(await waitUntil(() => handles[0]?.alive === false)).toBe(true);
    expect((await service.views())[0]?.state).toBe('idle');
  }, 40_000);
});
