import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../tools/registry';
import type { PermissionDecision, PermissionRequest } from '../tools/executor';
import type { ChatParams, ChatMessage, ProviderEvent } from '../providers/types';
import { HANDOFF_TOOL_NAME, runAgentTurn, type AgentLoopDeps, type LoopEvent } from './agent-loop';

/**
 * 三分支 Loop 的验收：
 * - final / tool / handoff 三条路径都要被走到；
 * - 熔断（maxTurns）必须真的停；
 * - 工具失败必须回传给模型而不是中断对话；
 * - 工具必须**串行**执行。
 *
 * 用可注入的假 provider / 假执行器，避免测试依赖真实网络。
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-loop-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 用脚本化的「每轮返回什么」来伪造 provider */
function scriptedChat(script: Array<{ text?: string; calls?: Array<{ name: string; args: unknown; id?: string }>; finish?: ProviderEvent }>) {
  const seenMessages: ChatMessage[][] = [];
  const seenTools: unknown[] = [];
  let turn = 0;

  const chat = (params: ChatParams): AsyncGenerator<ProviderEvent> => {
    seenMessages.push(params.messages.map((m) => ({ ...m })));
    seenTools.push(params.tools);
    const step = script[Math.min(turn, script.length - 1)];
    turn += 1;

    return (async function* () {
      if (step?.text) {
        for (const ch of step.text) yield { type: 'text_delta', delta: ch };
      }
      if (step?.calls && step.calls.length > 0) {
        let index = 0;
        for (const c of step.calls) {
          const argsText = JSON.stringify(c.args);
          yield {
            type: 'tool_calls',
            calls: [
              {
                index,
                id: c.id ?? `call_${index}`,
                name: c.name,
                argumentsText: argsText,
                arguments: c.args as Record<string, unknown>,
                parseError: null,
              },
            ],
          };
          index += 1;
        }
        yield { type: 'done', reason: 'tool_calls' };
        return;
      }
      yield { type: 'done', reason: 'stop' };
    })();
  };

  return { chat, seenMessages, seenTools, turnsUsed: () => turn };
}

function allow(): { resolver: (req: PermissionRequest) => Promise<PermissionDecision>; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolver: (req) => {
      asked.push(req.toolName);
      return Promise.resolve('allow_once');
    },
  };
}

function makeDeps(
  chat: AgentLoopDeps['chat'],
  permission: (req: PermissionRequest) => Promise<PermissionDecision>,
  alwaysAllow?: Set<string>,
): AgentLoopDeps {
  return {
    registry: createDefaultRegistry(),
    workspaceRoot: root,
    permission,
    chat,
    ...(alwaysAllow ? { alwaysAllow } : {}),
  };
}

describe('分支一：final', () => {
  it('模型直接回答 → branch=final，只走一轮，文本按增量拼出', async () => {
    const { chat } = scriptedChat([{ text: '你好，我是俱佳Agent' }]);
    const events: LoopEvent[] = [];

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [{ role: 'user', content: 'hi' }], emit: (e) => events.push(e) },
      makeDeps(chat, allow().resolver),
    );

    expect(res.branch).toBe('final');
    expect(res.reason).toBe('final');
    expect(res.turns).toBe(1);
    expect(res.text).toBe('你好，我是俱佳Agent');
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(12);
    expect(events.at(-1)).toEqual({ type: 'turn_end', turn: 1, branch: 'final' });
  });
});

describe('分支二：tool', () => {
  it('请求工具 → 执行 → 回传 tool 消息 → 第二轮给出最终答复', async () => {
    const { chat, seenMessages, seenTools } = scriptedChat([
      { calls: [{ name: 'write_file', args: { path: 'note.md', content: 'hi' } }] },
      { text: '已写入 note.md' },
    ]);
    const perm = allow();
    const events: LoopEvent[] = [];

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [{ role: 'user', content: '写个文件' }], emit: (e) => events.push(e) },
      makeDeps(chat, perm.resolver),
    );

    expect(res.branch).toBe('final');
    expect(res.turns).toBe(2);
    expect(res.text).toBe('已写入 note.md');

    // 文件确实落盘（且经过了权限门）
    expect((await stat(join(root, 'note.md'))).isFile()).toBe(true);
    expect(perm.asked).toEqual(['write_file']);

    // 第二轮请求必须带上：assistant(tool_calls) + 配对的 tool 消息
    const secondRound = seenMessages[1] ?? [];
    const assistantWithCalls = secondRound.find((m) => m.role === 'assistant' && m.toolCalls);
    const toolMsg = secondRound.find((m) => m.role === 'tool');
    expect(assistantWithCalls?.toolCalls?.[0]?.name).toBe('write_file');
    expect(toolMsg?.toolCallId).toBe(assistantWithCalls?.toolCalls?.[0]?.id);

    // 每一轮都必须带 tools（协议硬约束）
    expect((seenTools[1] as unknown[]).length).toBeGreaterThan(0);

    // 事件顺序：tool_start 在 tool_end 之前
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf('tool_start')).toBeLessThan(kinds.indexOf('tool_end'));
  });

  it('多个工具调用按顺序串行执行（不并发）', async () => {
    const order: string[] = [];
    const { chat } = scriptedChat([
      {
        calls: [
          { name: 'write_file', args: { path: 'a.txt', content: '1' }, id: 'c1' },
          { name: 'write_file', args: { path: 'b.txt', content: '2' }, id: 'c2' },
        ],
      },
      { text: 'done' },
    ]);

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [{ role: 'user', content: 'x' }], emit: (e) => {
        if (e.type === 'tool_start') order.push(e.callId);
      } },
      makeDeps(chat, allow().resolver),
    );

    expect(res.turns).toBe(2);
    expect(order).toEqual(['c1', 'c2']); // 严格按返回顺序
    expect((await stat(join(root, 'a.txt'))).isFile()).toBe(true);
    expect((await stat(join(root, 'b.txt'))).isFile()).toBe(true);
  });

  it('工具执行失败（未知工具名）→ 错误回传模型并继续，不中断对话', async () => {
    const { chat } = scriptedChat([
      { calls: [{ name: 'rm_rf', args: {} }] },
      { text: '那我换个方式' },
    ]);

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [{ role: 'user', content: 'x' }], emit: () => {} },
      makeDeps(chat, allow().resolver),
    );

    expect(res.branch).toBe('final');
    const toolMsg = res.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('tool_not_found');
  });

  it('用户拒绝授权 → 回传「已拒绝」文本，且磁盘未被修改', async () => {
    const { chat } = scriptedChat([
      { calls: [{ name: 'write_file', args: { path: 'never.txt', content: 'x' } }] },
      { text: '好的，我不写了' },
    ]);
    const deny = (): Promise<PermissionDecision> => Promise.resolve('deny');

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [{ role: 'user', content: 'x' }], emit: () => {} },
      makeDeps(chat, deny),
    );

    const toolMsg = res.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('用户拒绝');
    await expect(stat(join(root, 'never.txt'))).rejects.toThrow();
  });
});

describe('分支三：handoff', () => {
  it('模型调用 handoff 工具 → branch=handoff 并结束', async () => {
    const { chat } = scriptedChat([
      { calls: [{ name: HANDOFF_TOOL_NAME, args: { reason: '超出范围', target: 'subagent' } }] },
      { text: '不该走到这里' },
    ]);

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [{ role: 'user', content: 'x' }], emit: () => {} },
      makeDeps(chat, allow().resolver),
    );

    expect(res.branch).toBe('handoff');
    expect(res.reason).toBe('handoff');
    expect(res.turns).toBe(1);
    expect(res.messages.some((m) => m.role === 'tool' && m.content.includes('移交'))).toBe(true);
  });
});

describe('熔断：maxTurns', () => {
  it('模型反复请求工具 → 在上界处停止（reason=max_turns），不会无限循环', async () => {
    const { chat, turnsUsed } = scriptedChat([
      { calls: [{ name: 'list_dir', args: { path: '.' } }] },
    ]);
    const perm = allow();

    const res = await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
        emit: () => {},
        maxTurns: 3,
      },
      makeDeps(chat, perm.resolver),
    );

    expect(res.reason).toBe('max_turns');
    expect(res.turns).toBe(3);
    expect(turnsUsed()).toBe(3); // 确实只调了 3 次模型
    expect(res.error).toContain('最大迭代次数');
  });

  it('已经在外部被中止 → 不发起任何模型调用', async () => {
    const { chat, turnsUsed } = scriptedChat([{ text: 'x' }]);
    const ac = new AbortController();
    ac.abort();

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [], emit: () => {}, signal: ac.signal },
      makeDeps(chat, allow().resolver),
    );

    expect(res.reason).toBe('aborted');
    expect(turnsUsed()).toBe(0);
  });

  it('模型调用报错 → reason=error 且携带错误信息（不抛异常给调用方）', async () => {
    // 在发起阶段就失败（await 拒绝后本函数不会产出任何事件）
    const failing = (): AsyncGenerator<ProviderEvent> =>
      (async function* () {
        await Promise.reject(new Error('HTTP 401：invalid api key'));
        yield { type: 'done', reason: 'stop' as const };
      })();

    const res = await runAgentTurn(
      { connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, messages: [], emit: () => {} },
      makeDeps(failing, allow().resolver),
    );

    expect(res.reason).toBe('error');
    expect(res.error).toContain('401');
  });
});
