import type { Edge, Node } from '@xyflow/react';
import { CANVAS_GRAPH_VERSION, type CanvasGraph, type CanvasNode } from '@jujia/shared-ipc';

/**
 * 界面 ↔ 图契约的**双向映射**（M9a）。抽出来是因为 e2e 当场抓到过一个真缺陷：
 * 载入图时 `argsText` 没被带进节点数据 → 工具节点跑起来拿到空参数
 * （`read_file` 报"缺少 path"）—— 界面上看着好好的，只有**真跑一遍**才暴露。
 *
 * 这个模块只有"形状转换"，没有 IO；单测钉住**往返不丢字段**。
 */

export interface CanvasNodeData extends Record<string, unknown> {
  kind: 'prompt' | 'tool';
  /** 提示词节点的 prompt / 工具节点的 toolName */
  configText: string;
  /** 工具节点的参数（JSON 文本）；提示词节点不用 */
  argsText?: string;
  status: string;
}
export type FlowNode = Node<CanvasNodeData>;

export function toFlowNode(n: CanvasNode): FlowNode {
  return {
    id: n.id,
    position: { x: n.x, y: n.y },
    data: {
      kind: n.kind,
      configText: n.kind === 'prompt' ? String(n.config['prompt'] ?? '') : String(n.config['toolName'] ?? ''),
      // **工具节点的参数必须带过来**：少了它，跑起来就是"参数不合法"（真缺陷的现场）
      ...(n.kind === 'tool' ? { argsText: String(n.config['argsText'] ?? '{}') } : {}),
      status: 'pending',
    },
  };
}

export function toFlowEdge(e: { id: string; from: string; to: string }): Edge {
  return { id: e.id, source: e.from, target: e.to };
}

/** 界面状态 → 图契约（保存与运行都走它；两种节点各自的 config 形状在这里收口） */
export function toGraph(
  nodes: FlowNode[],
  edges: Edge[],
  connectionId: string,
  viewport: { x: number; y: number; zoom: number },
): CanvasGraph {
  return {
    version: CANVAS_GRAPH_VERSION,
    connectionId,
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      x: n.position.x,
      y: n.position.y,
      config:
        n.data.kind === 'prompt'
          ? { prompt: n.data.configText }
          : { toolName: n.data.configText, argsText: String(n.data.argsText ?? '{}') },
    })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target })),
    viewport,
  };
}
