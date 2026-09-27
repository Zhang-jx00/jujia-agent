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
function scriptedChat(
  script: Array<{
    text?: string;
    calls?: Array<{ name: string; args: unknown; id?: string }>;
    /** 这一段的用量（provider 在流尾给的 usage） */
    usage?: { in: number; out: number };
    finish?: ProviderEvent;
  }>,
) {
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
      if (step?.usage) {
        yield { type: 'usage', inputTokens: step.usage.in, outputTokens: step.usage.out };
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

/**
 * 用量事件（2026-09-27 接线）。
 *
 * 契约里的 `usage` 与界面的 token 行都早就存在，中间这一层（Loop）把它丢了 ——
 * 于是"能看到本轮花了多少 token"这件事**从来没能真的成立过一次**。
 * 少一层转发不会报错，只会让界面永远少一行：这正是最难发现的一类缺陷。
 */
describe('用量事件按整轮累计转发', () => {
  it('两段调用各给一次 usage → 界面收到的是累计值，而不是最后一段', async () => {
    const { chat } = scriptedChat([
      { text: '先调一下', calls: [{ name: 'list_dir', args: { path: '.' } }], usage: { in: 100, out: 5 } },
      { text: '完成', usage: { in: 200, out: 9 } },
    ]);
    const events: LoopEvent[] = [];
    await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'hi' }],
        maxTurns: 4,
        emit: (e) => events.push(e),
      },
      makeDeps(chat, allow().resolver),
    );
    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(2);
    expect(usage[0]).toEqual({ type: 'usage', inputTokens: 100, outputTokens: 5 });
    // 第二段带的是**整轮累计**：一次回答只报最后一段，会把前面调工具花掉的抹掉
    expect(usage[1]).toEqual({ type: 'usage', inputTokens: 300, outputTokens: 14 });
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

describe('回合级钩子接入（W5d-b）：拦提示词、注入上下文、按上限再走一步', () => {
  /** 假钩子运行器：按事件返回预设结果，并记录调用 */
  function fakeHooks(byEvent: Partial<Record<string, Partial<Record<string, unknown>>>> = {}) {
    const calls: string[] = [];
    return {
      calls,
      runner: {
        async run(p: { event: string }) {
          calls.push(p.event);
          return {
            blocked: false,
            reason: null,
            additionalContext: [],
            updatedInput: null,
            permissionDecision: null,
            permissionReason: null,
            continueTurn: false,
            diagnostics: [],
            ranCount: 0,
            ...(byEvent[p.event] ?? {}),
          };
        },
      },
    };
  }

  it('没显式给 promptText 时取**最后一条**用户消息（不是第一条）', async () => {
    const { chat } = scriptedChat([{ text: 'ok' }]);
    const seen: string[] = [];
    const runner = {
      async run(p: { matchTarget: string }) {
        seen.push(p.matchTarget);
        return {
          blocked: false,
          reason: null,
          additionalContext: [],
          updatedInput: null,
          permissionDecision: null,
          permissionReason: null,
          continueTurn: false,
          diagnostics: [],
          ranCount: 0,
        };
      },
    };

    await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [
          { role: 'user', content: '第一句' },
          { role: 'assistant', content: '中间回复' },
          { role: 'user', content: '最新一句' },
        ],
        emit: () => undefined,
      },
      { ...makeDeps(chat, allow().resolver), hooks: runner },
    );

    // 第一次匹配是 UserPromptSubmit
    expect(seen[0]).toBe('最新一句');
  });

  it('UserPromptSubmit 拦下提示词 → **一次模型调用都不发生**', async () => {
    const { chat, turnsUsed } = scriptedChat([{ text: '不该出现' }]);
    const { runner } = fakeHooks({ UserPromptSubmit: { blocked: true, reason: '禁止该提示词' } });

    const res = await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: '危险请求' }],
        emit: () => undefined,
      },
      { ...makeDeps(chat, allow().resolver), hooks: runner },
    );

    expect(res.branch).toBe('final');
    expect(res.reason).toBe('hook_blocked');
    expect(res.text).toBe('');
    expect(res.error).toContain('禁止该提示词');
    expect(turnsUsed()).toBe(0); // 关键：省钱也省风险
  });

  it('UserPromptSubmit 的附加上下文注入**系统消息**，而不是伪造一条用户消息', async () => {
    const { chat, seenMessages } = scriptedChat([{ text: '好的' }]);
    const { runner } = fakeHooks({ UserPromptSubmit: { additionalContext: ['一律用中文回答'] } });

    await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'hi' }],
        emit: () => undefined,
      },
      { ...makeDeps(chat, allow().resolver), hooks: runner },
    );

    const first = seenMessages[0] ?? [];
    expect(first[0]?.role).toBe('system');
    expect(String(first[0]?.content)).toContain('一律用中文回答');
    // 用户消息必须保持原样：钩子说的不是用户说的
    expect(first.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['hi']);
  });

  it('Stop 钩子要求继续 → 再走一步，但**有次数上限**（钩子写错不会死循环）', async () => {
    const { chat, turnsUsed } = scriptedChat([{ text: '我改完了' }]);
    const { runner, calls } = fakeHooks({
      Stop: { continueTurn: true, additionalContext: ['你还没跑测试'] },
    });

    const res = await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: '改一下' }],
        emit: () => undefined,
      },
      { ...makeDeps(chat, allow().resolver), hooks: runner },
    );

    expect(res.reason).toBe('final');
    // 1 次原始 + 上限 2 次继续 = 3 次模型调用后停下
    expect(turnsUsed()).toBe(3);
    // Stop 钩子被问到 3 次（每次都在准备结束时问）
    expect(calls.filter((c) => c === 'Stop')).toHaveLength(3);
    // 续走的上下文进入了消息（作为要求发给模型）
    expect(res.messages.some((m) => String(m.content).includes('你还没跑测试'))).toBe(true);
  });

  it('Stop 钩子不要求继续 → 行为与没有钩子完全一致', async () => {
    const { chat, turnsUsed } = scriptedChat([{ text: '完成' }]);
    const { runner } = fakeHooks();

    const res = await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: '做件事' }],
        emit: () => undefined,
      },
      { ...makeDeps(chat, allow().resolver), hooks: runner },
    );

    expect(res.reason).toBe('final');
    expect(turnsUsed()).toBe(1);
    expect(res.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  it('不传 hooks 时完全不碰钩子（默认空运行器）', async () => {
    const { chat } = scriptedChat([{ text: 'ok' }]);
    const res = await runAgentTurn(
      {
        connection: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
        messages: [{ role: 'user', content: 'hi' }],
        emit: () => undefined,
      },
      makeDeps(chat, allow().resolver),
    );
    expect(res.reason).toBe('final');
  });
});
