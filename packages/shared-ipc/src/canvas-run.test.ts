import { describe, expect, it } from 'vitest';
import { CANVAS_GRAPH_VERSION, type CanvasGraph, type CanvasNode } from './canvas-graph';
import { runGraph, summarizeRun, type NodeResult, type RunEvent } from './canvas-run';

/**
 * 画布执行的**编排层**（M9a）。它的判断全是"错了会静默出事"的类型：
 * 顺序错了图就跑错、被拒还继续等于拿半成品当输入、取消没传下去会留下"看起来还在跑"的节点。
 * 这里用**注入的假执行器**把每一条都钉住 —— 不需要 Electron、不需要真工具。
 */

const node = (id: string, kind: 'prompt' | 'tool' = 'prompt'): CanvasNode =>
  kind === 'prompt'
    ? { id, kind, x: 0, y: 0, config: { prompt: `说点 ${id}` } }
    : { id, kind, x: 0, y: 0, config: { toolName: 'list_dir', argsText: '{}' } };

const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });

const graph = (nodes: CanvasNode[], edges = [edge('a', 'b'), edge('b', 'c')]): CanvasGraph => ({
  version: CANVAS_GRAPH_VERSION,
  connectionId: 'conn-1',
  nodes,
  edges,
  viewport: { x: 0, y: 0, zoom: 1 },
});

const three = () => graph([node('a'), node('b', 'tool'), node('c')]);

/** 假执行器：按 id 记录被调用的顺序，返回值由各用例给 */
function recorder(results: Record<string, NodeResult> = {}) {
  const calls: string[] = [];
  const execute = async (n: CanvasNode): Promise<NodeResult> => {
    calls.push(n.id);
    return results[n.id] ?? { ok: true, output: `${n.id}-ok`, error: '' };
  };
  return { calls, execute };
}

describe('runGraph：按拓扑序跑，状态逐节点回写', () => {
  it('三步链按 a → b → c 执行，事件里每一步都有状态与步号', async () => {
    const { calls, execute } = recorder();
    const events: RunEvent[] = [];
    const outcome = await runGraph(three(), { maxSteps: 50, execute, onEvent: (e) => events.push(e) });

    expect(calls).toEqual(['a', 'b', 'c']);
    expect(outcome.reason).toBe('done');
    expect(outcome.states).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    expect(events.filter((e) => e.status === 'running').map((e) => e.step)).toEqual([1, 2, 3]);
  });

  it('顺序由依赖决定，与节点在数组里的先后无关', async () => {
    const g = graph([node('c'), node('b'), node('a')], [edge('b', 'c'), edge('a', 'b')]);
    const { calls, execute } = recorder();
    await runGraph(g, { maxSteps: 50, execute });
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('有环的图整体拒绝，一个节点都不执行', async () => {
    const g = graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute });
    expect(calls).toEqual([]);
    expect(outcome.reason).toBe('failed');
    expect(outcome.states).toEqual({ a: 'failed', b: 'failed' });
  });
});

describe('runGraph：失败与被拒都要**停下来**（不拿半成品当输入）', () => {
  it('中间一步失败 → 后面的不再跑，失败那步有原因', async () => {
    const { calls, execute } = recorder({ b: { ok: false, output: '', error: '目录不存在' } });
    const outcome = await runGraph(three(), { maxSteps: 50, execute });
    expect(calls).toEqual(['a', 'b']);
    expect(outcome.reason).toBe('failed');
    expect(outcome.states['b']).toBe('failed');
    expect(outcome.states['c']).toBe('pending');
    expect(summarizeRun(outcome)).toContain('目录不存在');
  });

  it('用户拒绝（denied）是**独立状态**，不是普通失败', async () => {
    const { calls, execute } = recorder({
      b: { ok: false, output: '', error: '用户拒绝了这一步', denied: true },
    });
    const outcome = await runGraph(three(), { maxSteps: 50, execute });
    expect(calls).toEqual(['a', 'b']);
    expect(outcome.states['b']).toBe('denied');
    expect(summarizeRun(outcome)).toContain('被拒');
  });
});

describe('runGraph：取消要传下去，剩下的标成 cancelled', () => {
  it('外部 abort 之后：当前节点收到信号，其余节点是 cancelled 而不是 pending', async () => {
    const controller = new AbortController();
    const seen: Array<string | null> = [];
    const calls: string[] = [];
    const execute = async (n: CanvasNode, signal: AbortSignal): Promise<NodeResult> => {
      calls.push(n.id);
      seen.push(signal.aborted ? 'aborted' : null);
      if (n.id === 'a') {
        controller.abort();
        return { ok: true, output: 'a-ok', error: '' };
      }
      return { ok: true, output: 'x', error: '' };
    };

    const outcome = await runGraph(three(), { maxSteps: 50, execute, signal: controller.signal });
    expect(calls).toEqual(['a']);
    expect(seen).toEqual([null]);
    // 整体结论是 cancelled —— 有节点没跑完，写 done 会让人以为整张图跑完了
    // （这条断言第一版跟着实现写成 done，是"照着实现写测试"的典型，改成应有的语义）
    expect(outcome.reason).toBe('cancelled');
    expect(outcome.states['b']).toBe('cancelled');
    expect(outcome.states['c']).toBe('cancelled');
  });

  it('执行中抛 AbortError：算取消，不算失败', async () => {
    const controller = new AbortController();
    const execute = async (n: CanvasNode): Promise<NodeResult> => {
      if (n.id === 'b') {
        controller.abort();
        throw new Error('aborted');
      }
      return { ok: true, output: 'ok', error: '' };
    };
    const outcome = await runGraph(three(), { maxSteps: 50, execute, signal: controller.signal });
    expect(outcome.reason).toBe('cancelled');
    expect(outcome.states['b']).toBe('cancelled');
  });
});

describe('runGraph：步数上界', () => {
  it('节点数超过上限 → 整体拒绝，不跑一半', async () => {
    const { calls, execute } = recorder();
    const outcome = await runGraph(three(), { maxSteps: 2, execute });
    expect(calls).toEqual([]);
    expect(outcome.reason).toBe('failed');
    expect(outcome.steps[0]?.note).toContain('节点数上限');
  });
});
