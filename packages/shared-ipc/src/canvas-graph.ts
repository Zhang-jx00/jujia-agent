import { z } from 'zod';

/**
 * 无限画布（M9）的**图契约与纯规则**（报备 `docs/DESIGN-M9-CANVAS.md` §三/§四，九条已批）。
 *
 * 为什么契约与规则同处一地：渲染层要用同一套规则做即时反馈（连成环时立刻拒），
 * 主进程要用它做保存前的把关 —— 两边各写一份必然漂。这个包**只有 zod 一个依赖**，
 * 渲染层与主进程都能引（agent-core 不能给渲染层引，它带 node 依赖）。
 *
 * 三条批复点名的硬约束在类型里就看得见：
 * ① **图里只有 `connectionId`**：没有放 API Key 的地方。所有对象 `.strict()` ——
 *    多一个字段（比如手写进去的 `apiKey`）直接解析失败，不是"存下来了但没人用"。
 * ② 每张图有自己的运行语义，不借某个会话的连接。
 * ③ 执行不在这里 —— 这个文件只回答"图长什么样、能不能连、按什么顺序跑"。
 */

/** 上限（§四 那张表）：集中在常量里，便于将来调 */
export const CANVAS_MAX_NODES = 200;
export const CANVAS_MAX_EDGES = 400;
/** 单个节点的配置（提示词 / 工具参数）上限 */
export const CANVAS_MAX_CONFIG_BYTES = 8 * 1024;
/** 图文件上限 */
export const CANVAS_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 单次执行的节点数上限（防"图里放了长链"把界面拖住） */
export const CANVAS_MAX_RUN_STEPS = 50;

/** 当前图格式版本（迁移骨架见 `migrateGraph`） */
export const CANVAS_GRAPH_VERSION = 1;

export const canvasNodeKindSchema = z.enum(['prompt', 'tool']);

export const canvasNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: canvasNodeKindSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    /**
     * - `prompt`：`{ prompt }`（跑起来就是一次单轮补全）
     * - `tool`：`{ toolName, argsText }`（argsText 是 JSON 文本，跑之前由工具自己的 parse 校验）
     */
    config: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CanvasNode = z.infer<typeof canvasNodeSchema>;

export const canvasEdgeSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** 起点节点 id */
    from: z.string().min(1).max(64),
    /** 终点节点 id */
    to: z.string().min(1).max(64),
  })
  .strict();
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

export const canvasGraphSchema = z
  .object({
    version: z.number().int().positive(),
    /** **只有连接 id** —— 密钥仍在 secret store（批复追加要求 b） */
    connectionId: z.string().min(1).max(64),
    nodes: z.array(canvasNodeSchema).max(CANVAS_MAX_NODES),
    edges: z.array(canvasEdgeSchema).max(CANVAS_MAX_EDGES),
    viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().positive() }).strict(),
  })
  .strict();
export type CanvasGraph = z.infer<typeof canvasGraphSchema>;

/**
 * 不许出现在图里的字段名（批复追加要求 b：图 JSON 不存 API Key）。
 *
 * 为什么要在**键名**上扫而不是只看 schema：节点的 `config` 是开放对象（工具参数千变万化），
 * `.strict()` 管不住它里面；而图是能被导出/分享的文件 —— 里面出现 `apiKey` 这类键名本身就是事故。
 * 扫的是键名不是值：提示词里出现"token"这个词是正常的，不用管。
 */
const FORBIDDEN_KEY_RE = /^(api[-_]?key|secret|password|token|authorization|bearer)$/i;

function findForbiddenKeys(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== 'object') return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_RE.test(k)) hits.push(k);
    hits.push(...findForbiddenKeys(v, depth + 1));
  }
  return hits;
}

export interface GraphProblem {
  /** 给人看的一句话（界面直接显示；执行前也会用它拦住整批） */
  message: string;
  nodeIds: string[];
}

// 自己数 UTF-8 字节，不用 Buffer 也不用 TextEncoder：
// 这个模块**渲染层也要引**（同一套规则做即时反馈）—— Buffer 是 Node 的东西，
// 而 TextEncoder 在这里的类型环境里不存在（本包不带 DOM lib）。六行换两个坑，值。
const utf8Bytes = (s: string): number => {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
};
const bytesOf = (value: unknown): number => utf8Bytes(JSON.stringify(value ?? null));

/**
 * 图能不能跑（保存前与执行前都问它）。
 * 返回空数组 = 没问题；每条都带上是哪些节点出的问题，界面据此高亮。
 */
export function validateGraph(graph: CanvasGraph): GraphProblem[] {
  const problems: GraphProblem[] = [];

  if (graph.nodes.length > CANVAS_MAX_NODES) {
    problems.push({ message: `节点太多（${graph.nodes.length} 个，上限 ${CANVAS_MAX_NODES}）`, nodeIds: [] });
  }
  if (graph.edges.length > CANVAS_MAX_EDGES) {
    problems.push({ message: `连线太多（${graph.edges.length} 条，上限 ${CANVAS_MAX_EDGES}）`, nodeIds: [] });
  }

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) problems.push({ message: `节点 id 重复：${n.id}`, nodeIds: [n.id] });
    ids.add(n.id);
    if (bytesOf(n.config) > CANVAS_MAX_CONFIG_BYTES) {
      problems.push({
        message: `节点「${n.id}」的配置超过 ${CANVAS_MAX_CONFIG_BYTES / 1024} KB`,
        nodeIds: [n.id],
      });
    }
    if (n.kind === 'prompt' && typeof n.config['prompt'] !== 'string') {
      problems.push({ message: `提示词节点「${n.id}」缺少 prompt`, nodeIds: [n.id] });
    }
    if (n.kind === 'tool' && typeof n.config['toolName'] !== 'string') {
      problems.push({ message: `工具节点「${n.id}」缺少 toolName`, nodeIds: [n.id] });
    }
    const forbidden = findForbiddenKeys(n.config);
    if (forbidden.length > 0) {
      problems.push({
        message: `节点「${n.id}」里出现了疑似密钥字段（${[...new Set(forbidden)].join('、')}）—— 图文件是能被导出分享的，密钥只留在密钥库里`,
        nodeIds: [n.id],
      });
    }
  }

  const edgeKeys = new Set<string>();
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      problems.push({ message: `连线 ${e.id} 指向了不存在的节点`, nodeIds: [e.from, e.to] });
      continue;
    }
    if (e.from === e.to) {
      problems.push({ message: `节点「${e.from}」连到了自己`, nodeIds: [e.from] });
    }
    if (edgeKeys.has(`${e.from}->${e.to}`)) {
      problems.push({ message: `重复的连线：${e.from} → ${e.to}`, nodeIds: [e.from, e.to] });
    }
    edgeKeys.add(`${e.from}->${e.to}`);
  }

  const cycle = findCycle(graph);
  if (cycle !== null) {
    // 环是**闭合路径**（a → b → a）：消息里读起来是"从哪绕回哪"；
    // nodeIds 去重，界面高亮不重复亮同一块
    problems.push({ message: `连成了环：${cycle.join(' → ')}`, nodeIds: [...new Set(cycle)] });
  }

  return problems;
}

/**
 * 找环（返回环上的节点序列，没有环返回 null）。
 * 用颜色标记的深度优先：白色未访问 / 灰色在栈上 / 黑色已完成 ——
 * 撞到灰色就是环。自环也走这条路（from === to 时立刻命中）。
 */
export function findCycle(graph: CanvasGraph): string[] | null {
  const out = new Map<string, string[]>();
  for (const n of graph.nodes) out.set(n.id, []);
  for (const e of graph.edges) out.get(e.from)?.push(e.to);

  const state = new Map<string, 'white' | 'gray' | 'black'>();
  for (const n of graph.nodes) state.set(n.id, 'white');
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, 'gray');
    stack.push(id);
    for (const next of out.get(id) ?? []) {
      const s = state.get(next) ?? 'white';
      if (s === 'gray') {
        const at = stack.indexOf(next);
        return [...stack.slice(at >= 0 ? at : 0), next];
      }
      if (s === 'white') {
        const hit = visit(next);
        if (hit !== null) return hit;
      }
    }
    stack.pop();
    state.set(id, 'black');
    return null;
  };

  for (const n of graph.nodes) {
    if ((state.get(n.id) ?? 'white') === 'white') {
      const hit = visit(n.id);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * 拓扑序（执行顺序）：没有前驱的先跑。
 * 有环返回 null —— 调用方必须先过 `validateGraph`，这里只是不假装能排。
 */
export function topoOrder(graph: CanvasGraph): string[] | null {
  const inDegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    out.set(n.id, []);
  }
  for (const e of graph.edges) {
    out.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue = graph.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const left = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  return order.length === graph.nodes.length ? order : null;
}

/**
 * 旧版本图 → 当前版本（迁移骨架；批复要点②要求"入口与测试都在，而不是写着好看"）。
 *
 * 现在只有 v1，所以：
 * - v1 → 原样通过；
 * - v0（从未发布过的早期形状）→ 补上缺省 viewport 与 version 之后**再过 schema**；
 * - 更高版本 → 明确拒绝（"这份图比本版本新"），不猜。
 */
export function migrateGraph(version: number, data: unknown): { ok: true; graph: CanvasGraph } | { ok: false; error: string } {
  if (version > CANVAS_GRAPH_VERSION) {
    return { ok: false, error: `这份图是用更新的版本（v${String(version)}）存的，本版本读不了。` };
  }
  if (version === CANVAS_GRAPH_VERSION) {
    const parsed = canvasGraphSchema.safeParse(data);
    return parsed.success ? { ok: true, graph: parsed.data } : { ok: false, error: '图的形状不合法（版本对但字段不对）。' };
  }
  if (version === 0) {
    const raw = (data ?? {}) as Record<string, unknown>;
    const upgraded = {
      ...raw,
      version: CANVAS_GRAPH_VERSION,
      viewport: raw['viewport'] ?? { x: 0, y: 0, zoom: 1 },
    };
    const parsed = canvasGraphSchema.safeParse(upgraded);
    return parsed.success
      ? { ok: true, graph: parsed.data }
      : { ok: false, error: 'v0 的图迁移之后仍不合法（缺字段的真补不了）。' };
  }
  return { ok: false, error: `未知的图格式版本：v${String(version)}` };
}
