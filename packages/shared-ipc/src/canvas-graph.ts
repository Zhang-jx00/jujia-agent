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

export const canvasNodeKindSchema = z.enum(['prompt', 'tool', 'condition']);

export const canvasNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: canvasNodeKindSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    /**
     * - `prompt`：`{ prompt }`（跑起来就是一次单轮补全）
     * - `tool`：`{ toolName, argsText }`（argsText 是 JSON 文本，跑之前由工具自己的 parse 校验）
     * - `condition`（B3）：`{ prompt, keyword }`（同样先跑一次单轮补全，再看回答含不含 keyword ——
     *   判定本身在编排层，见 `canvas-run.ts`；keyword 必须非空，"空关键词永远命中"是静默的假分支）
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
    /**
     * B3：条件节点出边的**出口**（`'true'` / `'false'`）。
     * 只有条件节点的出边带它（校验层强制执行）；其它节点带了 = 写错了。
     */
    fromPort: z.enum(['true', 'false']).optional(),
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
/**
 * 判定口径（复核 045 改片段匹配 + 复核 046 补豁免清单）：
 *
 * **敏感词元命中 且 不在豁免清单 → 拒。**
 *
 * - 第一版是两端锚定的正则（`^token$`），于是 `accessToken` / `clientSecret` / `privateKey`
 *   这些**真实世界最常见的写法**全被放过 —— 它们恰恰是 OAuth 与数据库配置里的标配；
 * - 改成片段匹配后，又反过来把 `maxTokens` 这类**最高频的 LLM 参数名**拦下 ——
 *   那不是"误报"，是让提示词节点根本没法配（功能不可用级）。所以必须配一份**显式豁免清单**。
 *
 * 豁免必须**点名**，不许通配放行：加一项之前先想清楚"它会不会真的藏密钥"，
 * 每加一项配一条测试（`canvas-graph.test.ts` 里那张表就是清单的可执行版本）。
 */
const SECRET_FRAGMENTS = [
  'apikey',
  'api_key',
  'api-key',
  'secret',
  'password',
  'passwd',
  'token',
  'authorization',
  'bearer',
  'privatekey',
  'private_key',
  'private-key',
];

/**
 * 显式豁免清单：**已知无害且高频**的参数名（小写比较）。
 * 每一项都在 `canvas-graph.test.ts` 里有对应断言 —— 清单本身就是被测对象。
 * 加之前先想清楚：它会不会真的藏密钥？（"看起来像"不够，要"它确实是模型/工具参数"）
 */
const HARMLESS_KEYS = new Set([
  'maxtokens',
  'max_tokens',
  'tokenlimit',
  'inputtokens',
  'outputtokens',
  'tokenspersecond',
  'temperature',
  'topp',
]);

function looksLikeSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  if (HARMLESS_KEYS.has(k)) return false;
  return SECRET_FRAGMENTS.some((f) => k.includes(f));
}

function findForbiddenKeys(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== 'object') return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (looksLikeSecretKey(k)) hits.push(k);
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
    if (n.kind === 'condition' && typeof n.config['prompt'] !== 'string') {
      problems.push({ message: `条件节点「${n.id}」缺少 prompt`, nodeIds: [n.id] });
    }
    if (n.kind === 'condition' && typeof n.config['keyword'] !== 'string') {
      problems.push({ message: `条件节点「${n.id}」缺少判定关键词 keyword`, nodeIds: [n.id] });
    }
    // 空关键词的 `includes('')` 永远为真 —— 那不是"永远走真口"的功能，是静默的假分支，必须拒
    if (n.kind === 'condition' && n.config['keyword'] === '') {
      problems.push({ message: `条件节点「${n.id}」的判定关键词不能为空（空关键词永远命中）`, nodeIds: [n.id] });
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
  /** B3：`节点#口` 只允许出现一次（条件节点的每个出口最多一条线） */
  const portKeys = new Set<string>();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
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

    // B3 出口规则：条件节点的出边必须指明走哪个口；别的节点不许带口（端口是条件节点的语法）
    const src = nodeById.get(e.from);
    if (src?.kind === 'condition') {
      if (e.fromPort === undefined) {
        problems.push({
          message: `条件节点「${e.from}」的连线 ${e.id} 没指明走哪个口（要带 fromPort："true" 或 "false"）`,
          nodeIds: [e.from],
        });
      } else if (portKeys.has(`${e.from}#${e.fromPort}`)) {
        problems.push({
          message: `条件节点「${e.from}」的 ${e.fromPort} 口连了不止一条线（每个口只能连一条）`,
          nodeIds: [e.from],
        });
      } else {
        portKeys.add(`${e.from}#${e.fromPort}`);
      }
    } else if (e.fromPort !== undefined) {
      problems.push({
        message: `「${e.from}」不是条件节点，连线 ${e.id} 不该带 true / false 出口（fromPort）`,
        nodeIds: [e.from],
      });
    }
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
 * **从某节点出发的下游闭包（含自身）**（B2 局部重跑的"范围"定义，批复口径第一条）。
 *
 * 界面（标记"重跑段"、重置哪些卡片）与编排层（只跑哪些节点）**共用这一个函数** ——
 * 两处各写一套"下游是谁"，迟早会漂成两种答案。节点不存在返回 `null`：
 * "从空气重跑"必须**明确拒绝**，绝不能被当成"那就跑整图"。
 */
export function downstreamClosure(graph: CanvasGraph, startId: string): Set<string> | null {
  if (!graph.nodes.some((n) => n.id === startId)) return null;
  const out = new Set<string>([startId]);
  // 边数有上限（400），直接往返扫到不动为止就够；不需要建邻接表
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of graph.edges) {
      if (out.has(e.from) && !out.has(e.to)) {
        out.add(e.to);
        grew = true;
      }
    }
  }
  return out;
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
