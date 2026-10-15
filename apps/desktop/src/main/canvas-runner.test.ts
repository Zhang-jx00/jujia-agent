import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import type { CanvasEventPayload, CanvasGraph } from '@jujia/shared-ipc';
import type { HookRunner, ToolRegistry } from '@jujia/agent-core';
import { createCanvasRunner, type CanvasRunnerDeps } from './canvas-runner';

/**
 * canvas-runner 的单测（复核 047 第二遍的异常路径实验转正）。
 *
 * 为什么有这一个文件：复核时用一次性脚本驱动**真实 runner + 真实慢速 SSE 服务**，
 * 抓到一个静默错报 —— 用户按「停止」后，`streamChat` 按设计产 `done(aborted)`（正常返回，不抛错），
 * 而 runner 此前没读这个字段：**半截回答被当成成功**（节点 ok、整图 done）；若一次字都还没吐，
 * 还会报成"模型没有返回内容（无密钥 / 超时 / 额度不足）"这种假诊断。
 * 下面四条把口径钉住（停止是「被取消」，不是成功也不是失败）。
 */

const servers: Server[] = [];
afterAll(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s) await new Promise((done) => s.close(done));
  }
});

/** 慢速 SSE 服务：每 60ms 一段，共 30 段（足够测试中途停） */
async function slowSseServer(): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${String(i)} ` } }] })}\n\n`);
      if (i >= 30) {
        res.write('data: [DONE]\n\n');
        res.end();
        clearInterval(timer);
      }
    }, 60);
    res.on('close', () => clearInterval(timer));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function makeGraph(): CanvasGraph {
  return {
    version: 1,
    connectionId: 'conn-1',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: 'n-1', kind: 'prompt', x: 0, y: 0, config: { prompt: '打个招呼' } }],
    edges: [],
  };
}

function makeDeps(baseUrl: string, events: CanvasEventPayload[]): CanvasRunnerDeps {
  return {
    getWorkspaceRoot: async () => null,
    loadPolicy: async () => ({
      mode: 'default',
      rules: [],
      alwaysAsk: [],
      rulesHealth: { source: 'primary', count: 0, recovered: false },
    }),
    // 提示词节点不碰权限 / 注册表 / 钩子（那三样只挂在工具节点上）——
    // 不假返回：真被碰到就抛错，把"不该被调用"变成可执行的断言
    // （原先是 `async () => 'allow'`：字面量根本不在 PermissionDecision 里，typecheck 红了两轮才被复核抓出）
    permission: async () => {
      throw new Error('提示词节点不该碰权限');
    },
    registry: { get: () => undefined } as unknown as ToolRegistry,
    resolveConnection: async () => ({ record: { baseUrl, model: 'm' }, apiKey: 'test-key-not-real' }),
    hooks: {} as unknown as HookRunner,
    emit: (e) => events.push(e),
  };
}

describe('createCanvasRunner：提示词节点的取消语义（复核 047 实验转正）', () => {
  it('正常跑完（对照组）：节点 ok、整体 done', async () => {
    const baseUrl = await slowSseServer();
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const r = await runner.run('g-ok', makeGraph());
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('done');
    expect(events.map((e) => e.status)).toEqual(['running', 'ok']);
  });

  it('中途停止：被取消就是被取消 —— 半截回答**不许**当成功', async () => {
    const baseUrl = await slowSseServer();
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const p = runner.run('g-stop-mid', makeGraph());
    await sleep(250); // 已经吐了几段（半截回答存在）
    expect(runner.stop('g-stop-mid')).toBe(true);
    const r = await p;
    const tail = events.map((e) => `${e.nodeId}:${e.status}`);
    expect(tail).toContain('n-1:cancelled');
    expect(r.reason).toBe('cancelled');
    expect(r.steps.some((s) => s.includes('ok'))).toBe(false);
    expect(runner.running()).toEqual([]);
    expect(runner.stop('g-stop-mid')).toBe(false); // 已经不在跑，停是空操作
  });

  it('一次字都没吐就停止：同样是 cancelled，不许报成"模型没有返回内容"那种假诊断', async () => {
    const baseUrl = await slowSseServer();
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const p = runner.run('g-stop-early', makeGraph());
    await sleep(20); // 第一个分片（60ms）还没来
    expect(runner.stop('g-stop-early')).toBe(true);
    const r = await p;
    expect(r.reason).toBe('cancelled');
    expect(events.every((e) => e.status !== 'failed')).toBe(true);
    expect(r.error.includes('模型没有返回内容')).toBe(false);
  });

  it('并发保护：同一张图第二次 run 被拒，且第二次不产生任何事件', async () => {
    const baseUrl = await slowSseServer();
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const first = runner.run('g-busy', makeGraph());
    await sleep(150);
    const before = events.length;
    const second = await runner.run('g-busy', makeGraph());
    expect(second.ok).toBe(false);
    expect(second.error).toContain('正在跑');
    expect(second.steps.length).toBe(0);
    expect(events.length).toBe(before);
    runner.stop('g-busy');
    await first;
  });
});

/**
 * B3 条件分支在真实 runner 里的两条真值：
 * ① 条件节点与提示词节点走的是**同一条** streamChat 单轮路径（makeDeps 的 permission 会直接抛错 ——
 *    条件节点若误碰工具那条路，测试立刻红）；
 * ② 结果里带**跳过数**（界面那句"几个执行、几个被跳过"用的是它，不是拿总节点数冒充）。
 */
function branchGraph(keyword: string): CanvasGraph {
  return {
    version: 1,
    connectionId: 'conn-1',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: 'c', kind: 'condition', x: 0, y: 0, config: { prompt: '判断一下', keyword } },
      { id: 'ty', kind: 'prompt', x: 0, y: 0, config: { prompt: '真口的工作' } },
      { id: 'fn', kind: 'prompt', x: 0, y: 0, config: { prompt: '假口的工作' } },
    ],
    edges: [
      { id: 'e1', from: 'c', to: 'ty', fromPort: 'true' },
      { id: 'e2', from: 'c', to: 'fn', fromPort: 'false' },
    ],
  };
}

describe('createCanvasRunner：B3 条件分支（同一条补全路径 + 跳过计数）', () => {
  it('命中关键词 → true 口那支跑、false 口那支 skipped；结果带跳过数', async () => {
    const baseUrl = await slowSseServer(); // 每个分片是 `tN `，全跑完的答案是 "t1 t2 … t30"
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const r = await runner.run('g-branch-true', branchGraph('t30'));

    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(1);
    const statuses = (id: string) => events.filter((e) => e.nodeId === id).map((e) => e.status);
    expect(statuses('c')).toEqual(['running', 'ok']); // 条件节点走的就是补全路径（碰权限的话 makeDeps 会抛）
    expect(statuses('ty')).toEqual(['running', 'ok']);
    expect(statuses('fn')).toEqual(['skipped']);
    expect(r.steps.some((s) => s.includes('走 true 口'))).toBe(true);
  }, 30_000);

  it('没命中 → false 口那支跑、true 口那支 skipped', async () => {
    const baseUrl = await slowSseServer();
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const r = await runner.run('g-branch-false', branchGraph('绝不出现的词'));

    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(1);
    const statuses = (id: string) => events.filter((e) => e.nodeId === id).map((e) => e.status);
    expect(statuses('fn')).toEqual(['running', 'ok']);
    expect(statuses('ty')).toEqual(['skipped']);
    expect(r.steps.some((s) => s.includes('走 false 口'))).toBe(true);
  }, 30_000);

  /**
   * 复核 050 第二遍的异常路径实验（转正）：关键词**横跨两条增量**才命中 ——
   * 判定看的是拼接后的完整回答，不是任何单条增量。这条专门钉"把增量拼起来"那一步：
   * 若有人把 `text += ev.delta` 写成 `text = ev.delta`（只留最后一片），上面两条用例仍会绿
   * （它们的关键词落在单片里），只有这条会红 —— 校准实验见台账。
   */
  it('关键词跨分片：两段增量拼起来才命中（判定看完整回答，不是单条增量）', async () => {
    const baseUrl = await slowSseServer(); // 分片是 `t1 ` `t2 ` …，关键词 "t5 t6" 横跨两条
    const events: CanvasEventPayload[] = [];
    const runner = createCanvasRunner(makeDeps(baseUrl, events));
    const r = await runner.run('g-branch-span', branchGraph('t5 t6'));

    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(1);
    const statuses = (id: string) => events.filter((e) => e.nodeId === id).map((e) => e.status);
    expect(statuses('ty')).toEqual(['running', 'ok']); // 真口那支
    expect(statuses('fn')).toEqual(['skipped']);
  }, 30_000);
});

/* ---------------- 工具节点的退出码要搬到节点上（T54 · R31） ---------------- */

/**
 * 这一条钉的是**链条的中间那一环**（本仓的老账：接线锁只钉中间一环，上下游断了照样绿）。
 * 上下游各自都有用例了 —— exec 工具把 `exitCode` 写进 `evidence`（`exec-tool.test.ts`）、
 * 编排层把非零退出说出来（`canvas-run.test.ts`）—— 但如果 `canvas-runner.ts` 里那句
 * `ok: res.outcome.ok` 没把 evidence 的两个字段搬过来，**画布仍然会把失败的命令显示成成功**，
 * 而那两个文件各自全绿。所以这里用真 `runTool` + 假工具走一遍完整链路。
 */
describe('createCanvasRunner：工具节点搬运 evidence 里的机器可读事实（T54）', () => {
  /** 假命令工具：跑完（ok:true），但退出码 128 —— 正是 `git push` 失败那个形状 */
  const failingExecTool = {
    name: 'fake_exec',
    description: '测试用：一条跑完但失败的命令',
    kind: 'exec',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    parse: () => ({}),
    run: async () => ({
      ok: true,
      content: 'error: failed to push some refs',
      evidence: { paths: [], durationMs: 1, exitCode: 128, timedOut: false },
    }),
  };

  const toolGraph = (): CanvasGraph => ({
    version: 1,
    connectionId: 'conn-1',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: 't-1', kind: 'tool', x: 0, y: 0, config: { toolName: 'fake_exec', argsText: '{}' } }],
    edges: [],
  });

  it('evidence.exitCode 必须出现在节点的那句话里（判定仍是 ok 不变）', async () => {
    const baseUrl = await slowSseServer(); // 工具节点不碰网络，给个合法值即可
    const events: CanvasEventPayload[] = [];
    const deps: CanvasRunnerDeps = {
      ...makeDeps(baseUrl, events),
      // 执行类是硬 ask：这里给"这一次允许"，让链路真的走到 run（不是绕开权限门）
      permission: async () => 'allow_once' as const,
      registry: {
        get: (name: string) => (name === 'fake_exec' ? (failingExecTool as never) : undefined),
      } as unknown as CanvasRunnerDeps['registry'],
      // 工具节点必经五处钩子调用（PreToolUse / PermissionRequest / Post…），
      // 而 `makeDeps` 里那个 `{} as HookRunner` 是给提示词节点用的（它们碰不到钩子，
      // 碰到了就抛错当断言）—— 走到工具这一支就必须给一个真的空结果。
      hooks: {
        run: async () => ({
          blocked: false,
          reason: null,
          additionalContext: [],
          updatedInput: null,
          permissionDecision: null,
          permissionReason: null,
          continueTurn: false,
          diagnostics: [],
          ranCount: 0,
        }),
      } as unknown as CanvasRunnerDeps['hooks'],
    };
    const runner = createCanvasRunner(deps);
    const r = await runner.run('g-exit-code', toolGraph());

    expect(r.ok).toBe(true); // **判定一行没动**：这条只验"那句话有没有说实话"
    const note = events.find((e) => e.nodeId === 't-1' && e.status === 'ok')?.note ?? '';
    expect(note).toContain('退出码 128');
  }, 30_000);
});
