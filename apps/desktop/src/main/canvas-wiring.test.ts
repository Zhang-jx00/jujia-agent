import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canvasEventSchema } from '@jujia/shared-ipc';

/**
 * M9a 的两条接线锁（报备 `docs/DESIGN-M9-CANVAS.md` §二/§八 与 §九之二(a)）：
 *
 * ① **执行模块只经既有链路**：工具节点 → `runTool`（同一注册表 + 同一权限门）；
 *    提示词节点 → `streamChat`（与对话同一个 provider 流式层）。编排层与执行器里
 *    **不许出现第二套执行器的形状**（`fetch(` 调用 / 自建 provider / 直接 fs / ipcMain）——
 *    编排层还额外钉死"它的 import 只有 `./canvas-graph` 一处"，把"零 IO"变成结构事实。
 * ② **事件要有归属**：节点事件出主进程前必须带 `graphId`（补在 runner 的 emit 处）、
 *    过契约（缺归属就地丢弃）、界面只认 `graphId === 当前图`。没有归属的事件不许进界面。
 *
 * 为什么这两条只认源码：它们的正确性**不在任何单个函数里** —— 编排与界面各自都可能是对的，
 * 但只要有人在 runner 里自己 `fetch`、或把事件不筛就写进状态，行为测试与全量单测都可能绿
 * （同 `tab-state-wiring` / `browser-wiring` 的理由）。行为真值由 e2e 第 40–42 步负责
 * （三节点链真的跑完 / 成环在开跑前被拒 / 工具节点与对话过同一扇审批门）。
 */

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const runner = read('./canvas-runner.ts');
const orchestrator = read('../../../../packages/shared-ipc/src/canvas-run.ts');
const ipc = read('./ipc/canvas.ts');
const panel = read('../renderer/src/features/canvas/CanvasPanel.tsx');

const FORBIDDEN: [RegExp, string][] = [
  [/fetch\s*\(/, '直接调 fetch'],
  [/new\s+OpenAI/, '自建 provider 客户端'],
  [/from\s+'node:fs'/, '直接引 node:fs'],
  [/from\s+'node:fs\/promises'/, '直接引 node:fs/promises'],
  [/require\s*\(/, 'CommonJS require'],
  [/ipcMain/, '自己碰 ipcMain'],
];

describe('执行模块只经既有链路（DESIGN §二/§八）', () => {
  it('执行器把两种节点分别接到 runTool 与 streamChat 上（与对话、手动执行同一条链）', () => {
    expect(runner).toContain("from '@jujia/agent-core'");
    expect(runner).toContain('runTool(');
    expect(runner).toContain('streamChat(');
  });

  it('工具节点走的是**同一扇门**：拿 deps.permission 与同一套 policy；不借会话白名单', () => {
    expect(runner).toContain('deps.permission');
    expect(runner).toContain('alwaysAsk: policy.alwaysAsk');
    // 会话级「总是允许」按 sessionId 记账：图执行必须用自己的桶，绝不能蹭某个聊天的
    expect(runner).toContain("sessionId: 'canvas'");
  });

  it('编排层是结构上的"零 IO"：它 import 的来源只有 ./canvas-graph 一处', () => {
    const imports = [...orchestrator.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./canvas-graph']);
  });

  it.each(FORBIDDEN)('执行器里不许出现 %s（%s）', (re) => {
    expect(runner).not.toMatch(re);
  });

  it.each(FORBIDDEN)('编排层里不许出现 %s（%s）', (re) => {
    expect(orchestrator).not.toMatch(re);
  });
});

describe('事件要有归属（DESIGN §九之二 a）', () => {
  it('runner 的 emit 出口补上 graphId（graphId 是这一层的知识，编排层只认识节点）', () => {
    expect(runner).toContain('deps.emit({ graphId, nodeId: e.nodeId');
  });

  it('主进程出口**先过契约再发**：缺 graphId/nodeId 的事件就地丢弃（不许溜到界面）', () => {
    expect(ipc).toContain('canvasEventSchema.safeParse(event)');
    expect(ipc.indexOf('canvasEventSchema.safeParse')).toBeLessThan(ipc.indexOf('IPC.CANVAS_EVENT'));
  });

  it('界面只认自己这张图的事件，且判别发生在写状态**之前**（不筛就是跨来源污染）', () => {
    const start = panel.indexOf('onCanvasEvent((event');
    const end = panel.indexOf('return off;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = panel.slice(start, end);
    expect(body).toContain('event.graphId !== graphId');
    expect(body.indexOf('setNodes(')).toBeGreaterThan(body.indexOf('event.graphId !== graphId'));
  });

  it('契约层：graphId / nodeId 缺一个就拒，多一个字段也拒（.strict）', () => {
    const base = { graphId: 'g-1', nodeId: 'n-1', status: 'ok' as const, step: 1, note: '' };
    expect(canvasEventSchema.safeParse(base).success).toBe(true);
    const { graphId: _g, ...noGraph } = base;
    expect(canvasEventSchema.safeParse(noGraph).success).toBe(false);
    const { nodeId: _n, ...noNode } = base;
    expect(canvasEventSchema.safeParse(noNode).success).toBe(false);
    expect(canvasEventSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

/**
 * B2 硬要求（复核放行时点名的第二条）：局部重跑**复用同一条执行链路** ——
 * 界面把起点交给与「运行这张图」**同一个 `canvasRun`**（多一个参数，不是新通道、不是新入口），
 * runner 把它作为 `startFrom` 透传给**同一个编排函数**；范围计算界面与编排层共用同一份纯函数。
 * 这条锁问的是"形状"：有人将来在画布侧自建第二套执行路径，这里先红。
 */
describe('B2：局部重跑复用同一链路（不许第二套执行路径）', () => {
  const runHandlers = read('../../../../packages/shared-ipc/src/canvas-run.ts');

  it('界面：重跑走的是同一个 window.jujia.canvasRun（带起点参数）', () => {
    expect(panel).toContain('window.jujia.canvasRun(graphId, nodeId);');
    // 范围用与编排层同一份纯函数（不是界面里自己数一遍"下游是谁"）
    expect(panel).toContain('downstreamClosure(graph, nodeId)');
    expect(runHandlers).toContain('downstreamClosure(graph, options.startFrom)');
  });

  it('runner：把起点原样作为 startFrom 交给编排层（同一方法、加参数）', () => {
    expect(runner).toContain('{ startFrom: fromNodeId }');
    expect(runner).toContain('run(graphId: string, graph: CanvasGraph, fromNodeId?: string)');
  });

  it('画布界面侧不出现第二套执行形状（runGraph / canvas-runner 都够不着界面）', () => {
    expect(panel).not.toContain('runGraph');
    expect(panel).not.toContain('canvas-runner');
  });
});
