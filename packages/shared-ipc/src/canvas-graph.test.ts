import { describe, expect, it } from 'vitest';
import {
  CANVAS_GRAPH_VERSION,
  CANVAS_MAX_CONFIG_BYTES,
  CANVAS_MAX_NODES,
  canvasGraphSchema,
  findCycle,
  migrateGraph,
  topoOrder,
  validateGraph,
  type CanvasGraph,
} from './canvas-graph';

/**
 * 画布的**纯规则层**（报备 §三/§四，九条已批 + 批复追加两条）。
 *
 * 这一层是"执行之前"的全部判断：能不能连（成环 / 重复边 / 悬空）、按什么顺序跑（拓扑序）、
 * 允不允许存（上限 / 不许有 key）、旧图能不能读（迁移）。
 * 执行本身不在这里 —— 它只经 `runTool` 与 agent-loop（接线锁另行钉住）。
 */

const node = (id: string, kind: 'prompt' | 'tool' = 'prompt', config: Record<string, unknown> = {}) => ({
  id,
  kind,
  x: 0,
  y: 0,
  config: kind === 'prompt' ? { prompt: `说点 ${id}`, ...config } : { toolName: 'list_dir', argsText: '{}', ...config },
});

const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });

const graph = (over: Partial<CanvasGraph> = {}): CanvasGraph => ({
  version: CANVAS_GRAPH_VERSION,
  connectionId: 'conn-1',
  nodes: [node('a'), node('b', 'tool')],
  edges: [edge('a', 'b')],
  viewport: { x: 0, y: 0, zoom: 1 },
  ...over,
});

describe('契约：图里只有 connectionId，多一个字段就拒（批复追加要求 b）', () => {
  it('合法图能过', () => {
    expect(canvasGraphSchema.safeParse(graph()).success).toBe(true);
  });

  it('**带 apiKey 的图存不进去** —— 密钥不进可分享文件', () => {
    const withKey = { ...graph(), apiKey: 'sk-should-not-be-here' };
    expect(canvasGraphSchema.safeParse(withKey).success).toBe(false);
    const keyInNode = {
      ...graph(),
      nodes: [node('a', 'prompt', { prompt: 'x', apiKey: 'sk-nope' }), node('b', 'tool')],
    };
    // 节点 config 是开放对象（工具参数千变万化），所以这里**只能靠约定**：
    // 提示词节点不接受多余字段 —— 用 .strict() 的 config 描述来钉
    expect(canvasGraphSchema.safeParse(keyInNode).success).toBe(true);
    // 真正拦住它的是下面这条：
    const problems = validateGraph(keyInNode as CanvasGraph);
    expect(problems.some((p) => p.message.includes('apiKey'))).toBe(true);
  });
});

describe('validateGraph：连错的图不许跑', () => {
  it('干净的链没有问题', () => {
    expect(validateGraph(graph())).toEqual([]);
  });

  it('成环被指出，且报出环上的节点', () => {
    const cyclic = graph({ nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('b', 'a')] });
    const problems = validateGraph(cyclic);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('连成了环');
    // 消息里是闭合路径（读得出"从哪绕回哪"），nodeIds 去重（界面高亮不重复亮同一块）
    expect(problems[0]?.message).toContain('a → b → a');
    expect(problems[0]?.nodeIds.sort()).toEqual(['a', 'b']);
  });

  it('自环也算环', () => {
    const self = graph({ nodes: [node('a')], edges: [edge('a', 'a')] });
    expect(findCycle(self)).not.toBeNull();
    expect(validateGraph(self).some((p) => p.message.includes('自己'))).toBe(true);
  });

  it('重复连线与悬空端点都点名', () => {
    const dup = graph({ nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('a', 'b')] });
    expect(validateGraph(dup).some((p) => p.message.includes('重复的连线'))).toBe(true);

    const dangling = graph({ edges: [{ id: 'x', from: 'a', to: 'ghost' }] });
    expect(validateGraph(dangling).some((p) => p.message.includes('不存在的节点'))).toBe(true);
  });

  it('节点类型缺必要配置（prompt / toolName）被点名', () => {
    const bad = graph({ nodes: [{ id: 'a', kind: 'prompt', x: 0, y: 0, config: {} }], edges: [] });
    expect(validateGraph(bad).some((p) => p.message.includes('缺少 prompt'))).toBe(true);
  });

  it('超过节点数上限要说话', () => {
    const many = Array.from({ length: CANVAS_MAX_NODES + 1 }, (_, i) => node(`n${String(i)}`));
    expect(validateGraph(graph({ nodes: many, edges: [] })).some((p) => p.message.includes('节点太多'))).toBe(true);
  });

  it('单节点配置超上限要说话', () => {
    const fat = graph({
      nodes: [node('a', 'prompt', { prompt: 'x'.repeat(CANVAS_MAX_CONFIG_BYTES + 10) })],
      edges: [],
    });
    expect(validateGraph(fat).some((p) => p.message.includes('KB'))).toBe(true);
  });
});

describe('topoOrder：按依赖顺序跑', () => {
  it('链是 a → b → c', () => {
    const g = graph({ nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')] });
    expect(topoOrder(g)).toEqual(['a', 'b', 'c']);
  });

  it('无依赖的图按节点顺序给（稳定，不随机）', () => {
    const g = graph({ nodes: [node('x'), node('y')], edges: [] });
    expect(topoOrder(g)).toEqual(['x', 'y']);
  });

  it('有环时返回 null（不假装排得出来）', () => {
    const g = graph({ nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('b', 'a')] });
    expect(topoOrder(g)).toBeNull();
  });
});

describe('migrateGraph：迁移骨架真的会跑（批复要点②）', () => {
  it('当前版本原样通过', () => {
    const r = migrateGraph(CANVAS_GRAPH_VERSION, graph());
    expect(r.ok).toBe(true);
  });

  it('v0 的旧图形能升上来（缺 viewport 就补默认）', () => {
    const v0 = { connectionId: 'conn-1', nodes: [node('a')], edges: [] };
    const r = migrateGraph(0, v0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.graph.version).toBe(CANVAS_GRAPH_VERSION);
      expect(r.graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    }
  });

  it('更高的版本明确拒绝（不猜、不静默降级）', () => {
    const r = migrateGraph(CANVAS_GRAPH_VERSION + 1, graph());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('更新');
  });
});
