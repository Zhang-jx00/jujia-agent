import { describe, expect, it } from 'vitest';
import { CANVAS_GRAPH_VERSION, type CanvasGraph } from '@jujia/shared-ipc';
import {
  CANVAS_ALIGN_THRESHOLD,
  CANVAS_GRID,
  planDragPosition,
  toFlowEdge,
  toFlowNode,
  toGraph,
  type Rect,
} from './canvas-bridge';

/**
 * 界面 ↔ 图的映射（M9a）。这条测试是**e2e 抓到的真缺陷**逼出来的：
 * 载入图时 `argsText` 没带进节点数据 → `read_file` 跑起来报"缺少 path"。
 * 形状转换这种"看着显然"的地方，恰恰要靠**往返不丢字段**来钉。
 */

const graph: CanvasGraph = {
  version: CANVAS_GRAPH_VERSION,
  connectionId: 'conn-1',
  nodes: [
    { id: 'n1', kind: 'prompt', x: 10, y: 20, config: { prompt: '说一句话' } },
    { id: 'n2', kind: 'tool', x: 30, y: 40, config: { toolName: 'read_file', argsText: '{"path":"a.txt"}' } },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
  viewport: { x: 1, y: 2, zoom: 1.5 },
};

describe('往返：载入 → 界面 → 存回，字段一个都不许丢', () => {
  it('工具节点的 argsText 原样带过（真缺陷的现场：少了它工具拿到空参数）', () => {
    const back = toGraph([toFlowNode(graph.nodes[1]!)], [], 'conn-1', graph.viewport);
    expect(back.nodes[0]?.config).toEqual({ toolName: 'read_file', argsText: '{"path":"a.txt"}' });
  });

  it('提示词节点的 prompt 与两种节点的坐标都原样带过', () => {
    const flow = graph.nodes.map(toFlowNode);
    const back = toGraph(flow, graph.edges.map(toFlowEdge), 'conn-1', graph.viewport);
    expect(back.nodes[0]).toMatchObject({ id: 'n1', kind: 'prompt', x: 10, y: 20 });
    expect(back.nodes[0]?.config).toEqual({ prompt: '说一句话' });
    expect(back.nodes[1]).toMatchObject({ id: 'n2', kind: 'tool', x: 30, y: 40 });
  });

  it('连线与视口也往返一致', () => {
    const back = toGraph(graph.nodes.map(toFlowNode), graph.edges.map(toFlowEdge), 'conn-1', graph.viewport);
    expect(back.edges).toEqual(graph.edges);
    expect(back.viewport).toEqual(graph.viewport);
  });

  it('工具节点缺 argsText 时给空对象（不是 undefined，工具那边才不用猜）', () => {
    const flow = toFlowNode({ id: 'n9', kind: 'tool', x: 0, y: 0, config: { toolName: 'list_dir' } });
    expect(flow.data.argsText).toBe('{}');
    const back = toGraph([flow], [], 'conn-1', { x: 0, y: 0, zoom: 1 });
    expect(back.nodes[0]?.config['argsText']).toBe('{}');
  });
});

/**
 * B1 的对齐/吸附（纯函数）。口径先写死在这里：
 * - **先网格、后对齐**（顺序有测试钉住，不是"碰巧这么写"）；
 * - 同类边才引导：左↔左、中↔中、右↔右（相邻贴合那种"引导"本批不做）；
 * - 阈值含等号：|差| ≤ 6 命中、7 不算；每轴只吸**最近**的一条线。
 * 坐标都取 16 的倍数做基准，避免手算网格化时出错（网格规则本身另有专测）。
 */

const at = (x: number, y: number, width = 160, height = 64): Rect => ({ x, y, width, height });
const MY = { width: 160, height: 64 };

describe('planDragPosition：先网格、后对齐', () => {
  it('没命中任何对齐：落点就是网格化后的原始位置（默认 16px 步长）', () => {
    const plan = planDragPosition({ x: 100, y: 203 }, MY, [at(800, 800)]);
    // 100/16 → 6.25 → round 6 → 96；203/16 → 12.69 → round 13 → 208
    expect(plan.x).toBe(96);
    expect(plan.y).toBe(208);
    expect(plan.vertical).toBeNull();
    expect(plan.horizontal).toBeNull();
  });

  it('左-左命中：吸到同一条竖线，辅助线纵跨两者（含自己）', () => {
    const plan = planDragPosition({ x: 96, y: 208 }, MY, [at(96, 400)]);
    expect(plan.vertical?.pos).toBe(96);
    expect(plan.x).toBe(96);
    expect(plan.vertical?.from).toBe(208);
    expect(plan.vertical?.to).toBe(464);
  });

  it('差 1px 的左边也能吸上：吸完贴在对方那条线上（线上不一定是网格倍数）', () => {
    const plan = planDragPosition({ x: 96, y: 208 }, MY, [at(97, 400)]);
    expect(plan.x).toBe(97);
    expect(plan.vertical?.pos).toBe(97);
  });

  it('中-中与右-右同样引导（不是只看左边）', () => {
    // 中-中：对方宽 100、x=202 → 中心 252；我宽 120、x=199 → 网格 192、中心 252 → 只有"中心"这一类命中
    const center = planDragPosition({ x: 199, y: 208 }, { width: 120, height: 64 }, [at(202, 400, 100)]);
    expect(center.x).toBe(192);
    expect(center.vertical?.pos).toBe(252);
    // 右-右：对方宽 100、x=260 → 右 360；我宽 168、x=199 → 网格 192、右 360 → 只有"右边"命中
    const right = planDragPosition({ x: 199, y: 208 }, { width: 168, height: 64 }, [at(260, 400, 100)]);
    expect(right.x).toBe(192);
    expect(right.vertical?.pos).toBe(360);
  });

  it('阈值边界：恰好 6 命中、7 不命中（含等号，写死）', () => {
    const hit = planDragPosition({ x: 96, y: 208 }, MY, [at(102, 400)]);
    const miss = planDragPosition({ x: 96, y: 208 }, MY, [at(103, 400)]);
    expect(hit.x).toBe(102);
    expect(hit.vertical?.pos).toBe(102);
    expect(miss.x).toBe(96);
    expect(miss.vertical).toBeNull();
  });

  it('两轴同时命中：两条辅助线都给', () => {
    // 对方 x=100（我网格后 96，差 4）、y=205（我网格后 208，顶上对顶上差 -3）
    const plan = planDragPosition({ x: 96, y: 208 }, MY, [at(100, 205)]);
    expect(plan.x).toBe(100);
    expect(plan.y).toBe(205);
    expect(plan.vertical?.pos).toBe(100);
    expect(plan.horizontal?.pos).toBe(205);
  });

  it('多个候选：每轴只吸最近的一条', () => {
    const near = at(98, 1000);
    const far = at(100, 2000);
    const plan = planDragPosition({ x: 96, y: 208 }, MY, [far, near]);
    expect(plan.vertical?.pos).toBe(98); // 差 2；另一个差 4
    expect(plan.x).toBe(98);
  });

  it('同类边才引导：我的左边撞上别人的右边，不算对齐（相邻贴合本批不做）', () => {
    // 对方 x=80、宽 22 → 右边 102，离我的左边（96）差 6 —— 同类边一个都没命中，不许引导
    const plan = planDragPosition({ x: 96, y: 208 }, MY, [at(80, 400, 22)]);
    expect(plan.vertical).toBeNull();
    expect(plan.x).toBe(96);
  });

  it('三节点同一条线上：辅助线纵跨三者的总范围（不是只画两段）', () => {
    const plan = planDragPosition({ x: 94, y: 350 }, MY, [at(96, 100), at(96, 600)]);
    expect(plan.x).toBe(96);
    expect(plan.vertical?.from).toBe(100);
    expect(plan.vertical?.to).toBe(664);
  });

  it('先网格后对齐的顺序是**可观察的**：网格化把落点挪出阈值，就不该再吸', () => {
    // 原始 106：先网格 → 112，与对方左线 99 差 13（超出阈值）→ 不吸。
    // 若实现反过来（先对齐再网格），106 离 99 差 7…… 也不吸；所以用差 6 的场景：
    // 原始 105：离 99 差 6（若"先对齐"会吸到 99）；先网格 → round(105/16)=7 → 112，差 13 → 不吸。
    const plan = planDragPosition({ x: 105, y: 208 }, MY, [at(99, 400)]);
    expect(plan.x).toBe(112);
    expect(plan.vertical).toBeNull();
  });

  it('常量对外可见且写死一对：网格 16、阈值 6', () => {
    expect(CANVAS_GRID).toBe(16);
    expect(CANVAS_ALIGN_THRESHOLD).toBe(6);
  });

  it('规划对落点是**幂等**的（拖动收尾那条 dragging:false 变更靠它兜底，不许把结果挪走）', () => {
    const others = [at(260, 400)];
    // 无对齐的普通落点：再规划一次不动
    const plain = planDragPosition({ x: 100, y: 208 }, MY, others);
    const plainAgain = planDragPosition({ x: plain.x, y: plain.y }, MY, others);
    expect(plainAgain.x).toBe(plain.x);
    expect(plainAgain.y).toBe(plain.y);
    // 对齐后的落点（260 不是网格倍数）：再规划一次仍回到 260，不许被网格拽回 256
    const aligned = planDragPosition({ x: 256, y: 208 }, MY, others);
    expect(aligned.x).toBe(260);
    const alignedAgain = planDragPosition({ x: aligned.x, y: aligned.y }, MY, others);
    expect(alignedAgain.x).toBe(260);
  });
});
