import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../tools/registry';
import type { PermissionAnswer, PermissionDecision, PermissionRequest } from '../tools/executor';
import { runAgentTurn, type LoopEvent } from './agent-loop';

/**
 * M2 验收的端到端验证：「让 Agent 创建 hello.md」。
 *
 * 与 `agent-loop.test.ts` 的差别：这里**不用打桩的 provider**，而是起一个真实的本地 SSE 服务
 * 按 OpenAI 协议回 `tool_calls`，走完整的
 * 「HTTP 请求 → SSE 分片解析 → tool_calls 拼装 → 权限门 → 路径沙箱 → 真落盘 → 回传 tool 消息 → 第二轮汇报」链路。
 * 不需要任何真实 API Key，因此 CI 上也能跑。
 */

let root: string;
const servers: Server[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-m2-'));
});

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
  await rm(root, { recursive: true, force: true });
});

/** 第一轮返回 write_file 的 tool_calls；第二轮返回最终文本 */
async function startAgentMock(options: {
  path: string;
  content: string;
  finalText: string;
  /** 把 arguments 切成若干片发送，验证分片拼装 */
  fragmentArguments?: boolean;
}): Promise<{ baseUrl: string }> {
  let call = 0;
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    call += 1;
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });

    const send = (payload: unknown): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    if (call === 1) {
      // 首帧只有 role（协议细节：不能假设每帧都有 content）
      send({ choices: [{ delta: { role: 'assistant' } }] });
      const args = JSON.stringify({ path: options.path, content: options.content });
      if (options.fragmentArguments) {
        const mid = Math.floor(args.length / 2);
        send({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_m2', function: { name: 'write_', arguments: args.slice(0, mid) } },
                ],
              },
            },
          ],
        });
        send({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: args.slice(mid) } }] } }],
        });
      } else {
        send({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_m2', function: { name: 'write_file', arguments: args } },
                ],
              },
            },
          ],
        });
      }
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      send({ choices: [{ delta: { content: options.finalText } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  };

  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1` };
}

function resolverReturning(
  value: PermissionDecision | PermissionAnswer,
): { fn: (req: PermissionRequest) => Promise<PermissionDecision | PermissionAnswer>; asked: PermissionRequest[] } {
  const asked: PermissionRequest[] = [];
  return {
    asked,
    fn: (req) => {
      asked.push(req);
      return Promise.resolve(value);
    },
  };
}

describe('M2 端到端：让 Agent 创建 hello.md', () => {
  it('同意后文件真的被创建，内容正确，且工具事件与两轮往返都发生', async () => {
    const mock = await startAgentMock({
      path: 'hello.md',
      content: '你好，俱佳',
      finalText: '已创建 hello.md',
    });
    const perm = resolverReturning('allow_once');
    const events: LoopEvent[] = [];

    const res = await runAgentTurn(
      {
        connection: { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: '帮我创建 hello.md，内容写「你好，俱佳」' }],
        emit: (e) => events.push(e),
      },
      {
        registry: createDefaultRegistry(),
        workspaceRoot: root,
        permission: perm.fn,
      },
    );

    // 1) 文件真的落盘且内容正确 —— 这是 M2 的硬标准
    expect(await readFile(join(root, 'hello.md'), 'utf8')).toBe('你好，俱佳');
    // 2) 走完了两轮（工具 → 汇报）
    expect(res.turns).toBe(2);
    expect(res.branch).toBe('final');
    expect(res.text).toBe('已创建 hello.md');
    // 3) 权限确实被询问过（不是绕过权限直接写）
    expect(perm.asked).toHaveLength(1);
    expect(perm.asked[0]?.toolName).toBe('write_file');
    // 4) UI 能看到工具开始/结束
    expect(events.some((e) => e.type === 'tool_start')).toBe(true);
    const end = events.find((e) => e.type === 'tool_end');
    expect(end && end.type === 'tool_end' ? end.ok : false).toBe(true);
  });

  it('arguments 分两片到达也能正确拼装（真实流式场景）', async () => {
    const mock = await startAgentMock({
      path: 'frag.md',
      content: '分片写入',
      finalText: '好了',
      fragmentArguments: true,
    });

    await runAgentTurn(
      {
        connection: { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
        emit: () => {},
      },
      {
        registry: createDefaultRegistry(),
        workspaceRoot: root,
        permission: resolverReturning('allow_once').fn,
      },
    );

    expect(await readFile(join(root, 'frag.md'), 'utf8')).toBe('分片写入');
  });

  it('用户拒绝 → 文件不存在，且模型收到"被拒绝"的提示', async () => {
    const mock = await startAgentMock({
      path: 'denied.md',
      content: 'x',
      finalText: '好的，我不写了',
    });

    const res = await runAgentTurn(
      {
        connection: { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
        emit: () => {},
      },
      {
        registry: createDefaultRegistry(),
        workspaceRoot: root,
        permission: resolverReturning('deny').fn,
      },
    );

    await expect(stat(join(root, 'denied.md'))).rejects.toThrow();
    const toolMsg = res.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('用户拒绝');
  });

  it('edit：把路径改到工作区内另一处，落盘的是**改后**的位置', async () => {
    const mock = await startAgentMock({
      path: 'unsafe.md',
      content: 'x',
      finalText: 'done',
    });

    await runAgentTurn(
      {
        connection: { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
        emit: () => {},
      },
      {
        registry: createDefaultRegistry(),
        workspaceRoot: root,
        permission: resolverReturning({
          decision: 'edit',
          updatedArgs: { path: 'safe/only.md', content: '改后内容' },
        }).fn,
      },
    );

    expect(await readFile(join(root, 'safe', 'only.md'), 'utf8')).toBe('改后内容');
    await expect(stat(join(root, 'unsafe.md'))).rejects.toThrow();
  });

  it('越界写入被路径沙箱拒绝，且工具失败会被回传模型（不中断对话）', async () => {
    // 模型试图写到工作区之外；权限即使全部放行也必须被路径守卫拦下
    const mock = await startAgentMock({
      path: '../escaped.md',
      content: 'x',
      finalText: '明白了，我不越界写',
    });

    const res = await runAgentTurn(
      {
        connection: { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
        emit: () => {},
      },
      {
        registry: createDefaultRegistry(),
        workspaceRoot: root,
        permission: resolverReturning('allow_once').fn,
      },
    );

    await expect(stat(join(root, '..', 'escaped.md'))).rejects.toThrow();
    const toolMsg = res.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('path_denied');
    // 失败不中断对话：模型仍给出了最终答复
    expect(res.branch).toBe('final');
    expect(res.text).toBe('明白了，我不越界写');
  });
});
