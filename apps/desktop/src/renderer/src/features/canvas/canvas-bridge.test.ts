import { describe, expect, it } from 'vitest';
import { CANVAS_GRAPH_VERSION, type CanvasGraph } from '@jujia/shared-ipc';
import { toFlowEdge, toFlowNode, toGraph } from './canvas-bridge';

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
