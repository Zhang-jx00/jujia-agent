import { describe, expect, it } from 'vitest';
import { CANVAS_GRAPH_VERSION, type CanvasEdge, type CanvasGraph, type CanvasNode } from './canvas-graph';
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

const graph = (nodes: CanvasNode[], edges: CanvasEdge[] = [edge('a', 'b'), edge('b', 'c')]): CanvasGraph => ({
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

/**
 * B2：局部重跑（`startFrom`）。批复口径：范围 = 该节点 + 全部下游、整体重置重跑、上游不动。
 * 编排层只认"范围"这一个旋钮 —— 上游节点**不执行、不发事件、不在 states 里**
 * （"没动"与"跑了"是两种事实，混在一起界面就画错了）。
 */
describe('runGraph：startFrom（局部重跑）', () => {
  it('从 b 出发：只跑 {b, c}，a 一个事件都没有、也不在 states 里', async () => {
    const { calls, execute } = recorder();
    const events: RunEvent[] = [];
    const outcome = await runGraph(three(), { maxSteps: 50, execute, startFrom: 'b', onEvent: (e) => events.push(e) });

    expect(calls).toEqual(['b', 'c']);
    expect(outcome.reason).toBe('done');
    expect(outcome.states).toEqual({ b: 'ok', c: 'ok' }); // a 不在内 —— 上游没动
    expect(events.every((e) => e.nodeId !== 'a')).toBe(true);
    expect(events.filter((e) => e.status === 'running').map((e) => e.step)).toEqual([1, 2]);
  });

  it('步号从 1 重新数（局部重跑是它自己的那一段）', async () => {
    const { execute } = recorder();
    const events: RunEvent[] = [];
    await runGraph(three(), { maxSteps: 50, execute, startFrom: 'c', onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.status === 'running').map((e) => e.step)).toEqual([1]);
  });

  it('菱形图从 b 出发：c 是旁支不跑，d 要跑（它是 b 的下游）', async () => {
    const g = graph(
      [node('a'), node('b', 'tool'), node('c', 'tool'), node('d')],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute, startFrom: 'b' });
    expect(calls).toEqual(['b', 'd']);
    expect(Object.keys(outcome.states).sort()).toEqual(['b', 'd']);
  });

  it('startFrom 指向不存在的节点：整体拒绝、零执行（防御；主进程那一层会给更具体的说法）', async () => {
    const { calls, execute } = recorder();
    const outcome = await runGraph(three(), { maxSteps: 50, execute, startFrom: 'nope' });
    expect(calls).toEqual([]);
    expect(outcome.reason).toBe('failed');
  });

  it('局部重跑里失败同样即停：b 失败 → c 不跑，原因可读', async () => {
    const { calls, execute } = recorder({ b: { ok: false, output: '', error: 'b 炸了' } });
    const outcome = await runGraph(three(), { maxSteps: 50, execute, startFrom: 'b' });
    expect(calls).toEqual(['b']);
    expect(outcome.reason).toBe('failed');
    expect(outcome.states['c']).toBe('pending');
    expect(outcome.steps.at(-1)?.note).toContain('b 炸了');
  });

  it('局部重跑中取消（执行中抛 AbortError）：当前节点 cancelled、理由独立、上游不在 states 里', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const execute = async (n: CanvasNode): Promise<NodeResult> => {
      calls.push(n.id);
      if (n.id === 'b') {
        controller.abort();
        throw new Error('aborted');
      }
      return { ok: true, output: 'ok', error: '' };
    };
    const outcome = await runGraph(three(), { maxSteps: 50, execute, startFrom: 'b', signal: controller.signal });
    expect(calls).toEqual(['b']);
    expect(outcome.reason).toBe('cancelled');
    expect(outcome.states['b']).toBe('cancelled');
    expect('a' in outcome.states).toBe(false);
  });

  it('局部重跑中取消（不抛、由循环顶判断）：该段其余节点标 cancelled、不会再执行', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const execute = async (n: CanvasNode): Promise<NodeResult> => {
      calls.push(n.id);
      if (n.id === 'b') controller.abort(); // 信号到了，但这一跳正常返回 —— 与整图口径一致
      return { ok: true, output: 'ok', error: '' };
    };
    const outcome = await runGraph(three(), { maxSteps: 50, execute, startFrom: 'b', signal: controller.signal });
    expect(calls).toEqual(['b']); // c 不再执行
    expect(outcome.states['c']).toBe('cancelled');
    expect(outcome.reason).toBe('cancelled');
    expect('a' in outcome.states).toBe(false);
  });

  it('不传 startFrom 时行为与从前一字不差（整图跑：三个都跑）', async () => {
    const { calls, execute } = recorder();
    const outcome = await runGraph(three(), { maxSteps: 50, execute });
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(outcome.states).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
  });
});

/**
 * B3：条件分支（真 / 假两出口 + `skipped`）。口径写死三条：
 * ① **关键词判定在纯层**：`回答.includes(keyword)` —— 和拓扑序、闭包一样是纯规则，不许散进执行器；
 * ② 未选分支**不执行**、状态是 `skipped`（既不是 cancelled 也不是 failed —— 整体结论照旧可以是 done）；
 * ③ `skipped` **不传播**：被跳过节点的下游同样 skipped；汇合点只要有一条**活路**进来就执行。
 */
const cond = (id: string, keyword: string): CanvasNode => ({
  id,
  kind: 'condition',
  x: 0,
  y: 0,
  config: { prompt: `判断 ${id}`, keyword },
});
const portEdge = (from: string, to: string, fromPort: 'true' | 'false'): CanvasEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  fromPort,
});

describe('runGraph：B3 条件分支', () => {
  it('命中关键词 → true 口执行、false 口 skipped（整体仍是 done）', async () => {
    const g = graph(
      [cond('c', 'c'), node('t'), node('f')],
      [portEdge('c', 't', 'true'), portEdge('c', 'f', 'false')],
    );
    const { calls, execute } = recorder(); // 假执行器默认输出 `${id}-ok`：c 的回答含关键词 'c'
    const events: RunEvent[] = [];
    const outcome = await runGraph(g, { maxSteps: 50, execute, onEvent: (e) => events.push(e) });

    expect(calls).toEqual(['c', 't']);
    expect(outcome.reason).toBe('done');
    expect(outcome.states).toEqual({ c: 'ok', t: 'ok', f: 'skipped' });
    const fEvent = events.find((e) => e.nodeId === 'f');
    expect(fEvent?.status).toBe('skipped');
    expect(fEvent?.note).toContain('没走');
  });

  it('没命中 → false 口执行（判定用的是"回答里含不含关键词"）', async () => {
    const g = graph(
      [cond('c', '绝不出现'), node('t'), node('f')],
      [portEdge('c', 't', 'true'), portEdge('c', 'f', 'false')],
    );
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute });
    expect(calls).toEqual(['c', 'f']);
    expect(outcome.states).toEqual({ c: 'ok', f: 'ok', t: 'skipped' });
  });

  it('被跳过节点的下游同样 skipped ——"没走这条"要一路传下去', async () => {
    const g = graph(
      [cond('c', 'c'), node('t'), node('f'), node('f2')],
      [portEdge('c', 't', 'true'), portEdge('c', 'f', 'false'), edge('f', 'f2')],
    );
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute });
    expect(calls).toEqual(['c', 't']);
    expect(outcome.states).toEqual({ c: 'ok', t: 'ok', f: 'skipped', f2: 'skipped' });
  });

  it('汇合点：有一条活路进来就执行（另一条死了不阻塞）', async () => {
    const g = graph(
      [cond('c', 'c'), node('t'), node('f'), node('j')],
      [portEdge('c', 't', 'true'), portEdge('c', 'f', 'false'), edge('t', 'j'), edge('f', 'j')],
    );
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute });
    expect(calls).toEqual(['c', 't', 'j']);
    expect(outcome.states['j']).toBe('ok');
  });

  it('skipped 不占步号：跳过之后，继续执行的节点步号仍然连续', async () => {
    const g = graph(
      [cond('c', 'c'), node('t'), node('f'), node('t2')],
      [portEdge('c', 't', 'true'), edge('t', 't2'), portEdge('c', 'f', 'false')],
    );
    const { execute } = recorder();
    const events: RunEvent[] = [];
    await runGraph(g, { maxSteps: 50, execute, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.status === 'running').map((e) => `${e.nodeId}:${String(e.step)}`)).toEqual([
      'c:1',
      't:2',
      't2:3',
    ]);
    expect(events.find((e) => e.status === 'skipped')?.step).toBe(2);
  });

  it('取消优先于跳过：abort 之后剩下的节点是 cancelled（不是 skipped）', async () => {
    const g = graph(
      [cond('c', 'c'), node('t'), node('f')],
      [portEdge('c', 't', 'true'), portEdge('c', 'f', 'false')],
    );
    const controller = new AbortController();
    const calls: string[] = [];
    const execute = async (n: CanvasNode): Promise<NodeResult> => {
      calls.push(n.id);
      if (n.id === 'c') controller.abort(); // 条件节点正常返回，但信号已经到
      return { ok: true, output: `${n.id}-ok`, error: '' };
    };
    const outcome = await runGraph(g, { maxSteps: 50, execute, signal: controller.signal });
    expect(calls).toEqual(['c']);
    expect(outcome.states['t']).toBe('cancelled');
    expect(outcome.states['f']).toBe('cancelled');
    expect(outcome.reason).toBe('cancelled');
  });

  it('摘要说得清"跳过几个"，不把它们混进完成数', async () => {
    const g = graph(
      [cond('c', 'c'), node('t'), node('f')],
      [portEdge('c', 't', 'true'), portEdge('c', 'f', 'false')],
    );
    const { execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute });
    expect(summarizeRun(outcome)).toBe('2 步完成，跳过 1 个');
  });

  it('条件节点没有可判定的关键词：显式失败（保存前本会拦，这里兜底）—— 绝不默认走 true', async () => {
    const g = graph([{ id: 'c2', kind: 'condition', x: 0, y: 0, config: { prompt: 'p' } }], []);
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute });
    expect(calls).toEqual([]); // 连模型都不问 —— 没关键词就没有可判定的问题
    expect(outcome.reason).toBe('failed');
    expect(outcome.states['c2']).toBe('failed');
    expect(outcome.steps.at(-1)?.note).toContain('关键词');
  });

  it('局部重跑：起点在被跳过分支的下游也照常跑（上游不在名单里，不参与活路判定）', async () => {
    const g = graph(
      [cond('c', 'zzz'), node('f'), node('f2')],
      [portEdge('c', 'f', 'false'), edge('f', 'f2')],
    );
    const { calls, execute } = recorder();
    const outcome = await runGraph(g, { maxSteps: 50, execute, startFrom: 'f' });
    expect(calls).toEqual(['f', 'f2']);
    expect(outcome.reason).toBe('done');
    expect(outcome.states).toEqual({ f: 'ok', f2: 'ok' });
  });
});
