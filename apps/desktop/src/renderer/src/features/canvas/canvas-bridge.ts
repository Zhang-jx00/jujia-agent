import type { Edge, Node } from '@xyflow/react';
import { CANVAS_GRAPH_VERSION, type CanvasEdge, type CanvasGraph, type CanvasNode } from '@jujia/shared-ipc';

/**
 * 界面 ↔ 图契约的**双向映射**（M9a）。抽出来是因为 e2e 当场抓到过一个真缺陷：
 * 载入图时 `argsText` 没被带进节点数据 → 工具节点跑起来拿到空参数
 * （`read_file` 报"缺少 path"）—— 界面上看着好好的，只有**真跑一遍**才暴露。
 *
 * 这个模块只有"形状转换"，没有 IO；单测钉住**往返不丢字段**。
 */

export interface CanvasNodeData extends Record<string, unknown> {
  kind: 'prompt' | 'tool' | 'condition';
  /** 提示词 / 条件节点的 prompt、工具节点的 toolName */
  configText: string;
  /** 工具节点的参数（JSON 文本）；提示词 / 条件节点不用 */
  argsText?: string;
  /** B3：条件节点的判定关键词；其余节点不用 */
  keywordText?: string;
  status: string;
  /** B2：本节点在**最近一次局部重跑**的范围里（卡片上打「重跑」标；整图跑/重开图时清掉） */
  rerun?: boolean;
}
export type FlowNode = Node<CanvasNodeData>;

export function toFlowNode(n: CanvasNode): FlowNode {
  return {
    id: n.id,
    position: { x: n.x, y: n.y },
    data: {
      kind: n.kind,
      configText: n.kind === 'tool' ? String(n.config['toolName'] ?? '') : String(n.config['prompt'] ?? ''),
      // **工具节点的参数必须带过来**：少了它，跑起来就是"参数不合法"（真缺陷的现场）
      ...(n.kind === 'tool' ? { argsText: String(n.config['argsText'] ?? '{}') } : {}),
      // B3：条件节点的关键词同理 —— 少了它，判定永远判不出（空串在保存前会被拦）
      ...(n.kind === 'condition' ? { keywordText: String(n.config['keyword'] ?? '') } : {}),
      status: 'pending',
    },
  };
}

/** B3：图里的口 ↔ React Flow 的 handle id，只有这一对合法值（别处一律不认） */
const portOf = (handle: string | null | undefined): 'true' | 'false' | undefined =>
  handle === 'true' || handle === 'false' ? handle : undefined;

export function toFlowEdge(e: CanvasEdge): Edge {
  return {
    id: e.id,
    source: e.from,
    target: e.to,
    ...(e.fromPort === undefined ? {} : { sourceHandle: e.fromPort }),
  };
}

/** 界面状态 → 图契约（保存与运行都走它；三种节点各自的 config 形状在这里收口） */
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
          : n.data.kind === 'tool'
            ? { toolName: n.data.configText, argsText: String(n.data.argsText ?? '{}') }
            : { prompt: n.data.configText, keyword: String(n.data.keywordText ?? '') },
    })),
    edges: edges.map((e) => {
      const port = portOf(e.sourceHandle);
      return { id: e.id, from: e.source, to: e.target, ...(port === undefined ? {} : { fromPort: port }) };
    }),
    viewport,
  };
}

/* ------------------------------------------------------------------ *
 * B1：拖动时的网格与对齐（全部是**纯函数** —— 判定、吸附、辅助线的
 * 几何都在这里，渲染层只负责画线；有单测、有变异）
 * ------------------------------------------------------------------ */

/** 网格步长（16px：React Flow 内建默认，且与 CSS 间距体系整除） */
export const CANVAS_GRID = 16;
/** 对齐阈值：判定与吸附**同一阈值**（太大了会"抢位置"，太小了够不着） */
export const CANVAS_ALIGN_THRESHOLD = 6;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignLine {
  /** 线所在的绝对坐标（竖线给 x，横线给 y） */
  pos: number;
  /** 另一轴上的覆盖范围（画线端点） */
  from: number;
  to: number;
}

export interface AlignPlan {
  /** 吸附后的落点（先网格、后对齐的最终值） */
  x: number;
  y: number;
  /** 竖直辅助线（贴着 x 的那条；无命中为 null） */
  vertical: AlignLine | null;
  /** 水平辅助线（无命中为 null） */
  horizontal: AlignLine | null;
}

/** 一条轴上的采样：start+size 是自身的两端，from/to 是另一轴的范围 */
interface AxisItem {
  start: number;
  size: number;
  from: number;
  to: number;
}

/**
 * 单轴对齐：同类边才引导（左↔左 / 中↔中 / 右↔右），命中取**最近**的一条。
 * 相邻贴合（我的左撞别人的右）本批不做 —— 那是另一种引导，别混进来。
 */
function alignAxis(
  moving: AxisItem,
  others: AxisItem[],
  threshold: number,
): { delta: number; line: AlignLine | null } {
  const own = [moving.start, moving.start + moving.size / 2, moving.start + moving.size];
  let best: { delta: number; pos: number } | null = null;
  for (const o of others) {
    const theirs = [o.start, o.start + o.size / 2, o.start + o.size];
    for (let k = 0; k < 3; k++) {
      const d = (theirs[k] ?? 0) - (own[k] ?? 0);
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, pos: theirs[k] ?? 0 };
      }
    }
  }
  if (best === null) return { delta: 0, line: null };
  // 辅助线的覆盖范围：所有"拥有这条线"的矩形（含自己）的并集 —— 三个节点同线时纵跨三者
  const eps = 0.5;
  const touching = others.filter((o) =>
    [o.start, o.start + o.size / 2, o.start + o.size].some((e) => Math.abs(e - best.pos) <= eps),
  );
  return {
    delta: best.delta,
    line: {
      pos: best.pos,
      from: Math.min(moving.from, ...touching.map((o) => o.from)),
      to: Math.max(moving.to, ...touching.map((o) => o.to)),
    },
  };
}

/**
 * 拖动落点的完整规划：**先网格化原始坐标，再做对齐吸附**（顺序有单测钉住 ——
 * 反过来会让"网格把落点挪出阈值"这类情形表现不同）。
 */
export function planDragPosition(
  raw: { x: number; y: number },
  size: { width: number; height: number },
  others: Rect[],
  opts: { grid?: number; threshold?: number } = {},
): AlignPlan {
  const grid = opts.grid ?? CANVAS_GRID;
  const threshold = opts.threshold ?? CANVAS_ALIGN_THRESHOLD;
  const gx = Math.round(raw.x / grid) * grid;
  const gy = Math.round(raw.y / grid) * grid;

  const vertical = alignAxis(
    { start: gx, size: size.width, from: gy, to: gy + size.height },
    others.map((r) => ({ start: r.x, size: r.width, from: r.y, to: r.y + r.height })),
    threshold,
  );
  const horizontal = alignAxis(
    { start: gy, size: size.height, from: gx, to: gx + size.width },
    others.map((r) => ({ start: r.y, size: r.height, from: r.x, to: r.x + r.width })),
    threshold,
  );

  return {
    x: gx + vertical.delta,
    y: gy + horizontal.delta,
    vertical: vertical.line,
    horizontal: horizontal.line,
  };
}
