import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CANVAS_GRAPH_VERSION,
  CANVAS_MAX_CONFIG_BYTES,
  CANVAS_MAX_NODES,
  canvasGraphSchema,
  downstreamClosure,
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

/**
 * 跨运行时的依赖纪律（复核 045 表扬并建议沉淀的那条）：
 * 这个包**渲染层也要引**（同一套规则做即时反馈），所以底层只能用两边都有的东西 ——
 * 不引 Node 专属（`Buffer`）、不引 DOM 专属（`TextEncoder`）；两者都不可用就自己写纯函数
 * （UTF-8 字节数那六行就是这么来的）。这条锁防止将来有人顺手把它们写回来：
 * 类型检查会因为 `types: ["node"]` 放行，但运行到渲染层就炸。
 */
describe('跨运行时边界：不许引 Node / DOM 专属的东西', () => {
  it('源码里不出现 Buffer / TextEncoder（两边都有的才许用）', () => {
    // 注释里提这两名字是**解释为什么不用它们**，所以先剥注释再扫（与接线锁同一手法）
    const src = readFileSync(new URL('./canvas-graph.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('Buffer');
    expect(src).not.toContain('TextEncoder');
  });
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

  /**
   * 键名扫描的**判据是"宁可误报也不漏"**（复核 045 的必改）：
   * 原先正则两端锚定（`^token$`），于是 `accessToken` / `clientSecret` / `privateKey`
   * 这些**真实世界最常见的写法**全被放过 —— 而它们恰恰是 OAuth / 数据库配置里的标配。
   * 误报的代价是用户改个字段名；漏的代价是密钥进了能被导出的文件。
   */
  it('大小写与前缀变体都拦得住（accessToken / clientSecret / privateKey / dbPassword）', () => {
    for (const key of ['accessToken', 'refresh_token', 'clientSecret', 'privateKey', 'dbPassword', 'api_key', 'Authorization', 'passwd']) {
      const g = graph({
        nodes: [node('a', 'prompt', { prompt: 'x', [key]: 'v' })],
        edges: [],
      });
      const problems = validateGraph(g as CanvasGraph);
      expect(problems.some((p) => p.message.includes('疑似密钥字段')), `${key} 没被拦住`).toBe(true);
    }
  });

  /**
   * 豁免清单（复核 046 的修正）：片段匹配会把 `maxTokens` 这类**最高频的 LLM 参数名**也拦下 ——
   * 那不是"误报"，是让提示词节点根本没法配（功能不可用级）。
   * 判据因此改成：**敏感词元命中 且 不在豁免清单 → 拒**；豁免必须是**显式可审计的清单**，不是通配放行。
   */
  it('已知无害的高频参数名被显式豁免（每项一条断言）', () => {
    const harmless = [
      'maxTokens',
      'max_tokens',
      'tokenLimit',
      'inputTokens',
      'outputTokens',
      'temperature',
      'topP',
      'tokensPerSecond',
    ];
    for (const key of harmless) {
      const g = graph({ nodes: [node('a', 'prompt', { prompt: 'x', [key]: 1 })], edges: [] });
      expect(validateGraph(g as CanvasGraph), `${key} 不该被拦`).toEqual([]);
    }
  });

  it('豁免是**点名的**，不是通配：换个前缀就照样拦（accessToken 仍被拒）', () => {
    const g = graph({
      nodes: [node('a', 'prompt', { prompt: 'x', accessToken: 't', maxTokens: 1 })],
      edges: [],
    });
    const problems = validateGraph(g as CanvasGraph);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('accessToken');
  });

  it('普通字段名与**值**里的这些词不受影响（不误报）', () => {
    const ok = graph({
      nodes: [node('a', 'prompt', { prompt: '把 token 这个词写进提示词是正常的' })],
      edges: [],
    });
    expect(validateGraph(ok as CanvasGraph)).toEqual([]);
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

  /**
   * 上限是按**字节**算的，不是按字符数 —— 中文一个字 3 字节。
   * 这条专门钉住"自己数 UTF-8"那六行：如果退回"每个字符算 1 字节"，
   * 一份 3 千字的中文提示词（9 KB，已超限）就会被当成 3 KB 放行。
   */
  it('上限按字节算：同样字符数，中文超限、英文不超', () => {
    const cjk = graph({
      nodes: [node('a', 'prompt', { prompt: '中'.repeat(CANVAS_MAX_CONFIG_BYTES / 2) })],
      edges: [],
    });
    expect(validateGraph(cjk as CanvasGraph).some((p) => p.message.includes('KB'))).toBe(true);

    const ascii = graph({
      nodes: [node('a', 'prompt', { prompt: 'x'.repeat(CANVAS_MAX_CONFIG_BYTES / 2) })],
      edges: [],
    });
    expect(validateGraph(ascii as CanvasGraph)).toEqual([]);
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

/**
 * B2：局部重跑的**范围计算**（纯函数，批复口径：范围 = 该节点 + 全部下游）。
 * 界面与编排层共用这一个函数 —— 两处各写一套"下游是谁"必然会漂。
 */
describe('downstreamClosure：从某节点出发的下游闭包（含自身）', () => {
  const chain = (): CanvasGraph =>
    graph({
      nodes: [node('a'), node('b', 'tool'), node('c')],
      edges: [edge('a', 'b'), edge('b', 'c')],
    });

  it('链 a→b→c：从 b 出发 = {b, c}（上游 a 不在内）', () => {
    const s = downstreamClosure(chain(), 'b');
    expect(s).not.toBeNull();
    expect([...(s ?? [])].sort()).toEqual(['b', 'c']);
  });

  it('从 a 出发 = 全部；从 c 出发 = {c}', () => {
    expect([...(downstreamClosure(chain(), 'a') ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect([...(downstreamClosure(chain(), 'c') ?? [])].sort()).toEqual(['c']);
  });

  it('菱形 a→b、a→c、b→d、c→d：从 b 出发只拿 b 与 d（c 是旁支，不牵连）', () => {
    const diamond = graph({
      nodes: [node('a'), node('b', 'tool'), node('c', 'tool'), node('d')],
      edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    });
    expect([...(downstreamClosure(diamond, 'b') ?? [])].sort()).toEqual(['b', 'd']);
  });

  it('孤立节点 = 只有自己；节点不存在 = null（明确拒绝，不是"当整图跑"）', () => {
    const lonely = graph({ nodes: [node('x')], edges: [] });
    expect([...(downstreamClosure(lonely, 'x') ?? [])]).toEqual(['x']);
    expect(downstreamClosure(chain(), 'nope')).toBeNull();
  });
});

/**
 * B3：条件分支（真 / 假两出口）。契约层先定死四条口径：
 * ① `kind` 多一档 `'condition'`，配置 `{ prompt, keyword }` —— keyword 必须**非空**：
 *    空串的 `includes` 永远为真 = 静默"总走真口"，比报错坏得多；
 * ② 条件节点的出边**必须带 `fromPort`**（`'true'` / `'false'`）：没有口的边不知道走哪边；
 * ③ 每个口**最多一条线**（两条线"都走 true"是歧义，不是功能）；
 * ④ 非条件节点的连线**不许**带 `fromPort` —— 端口是条件节点的语法，别处出现就是写错了。
 */
const condNode = (id: string, keyword = '好') => ({
  id,
  kind: 'condition' as const,
  x: 0,
  y: 0,
  config: { prompt: `判断 ${id}`, keyword },
});

describe('B3：条件节点的契约与校验', () => {
  it('条件节点（prompt + keyword）是合法形状；kind 三档都在', () => {
    const g = graph({ nodes: [condNode('c')], edges: [] });
    expect(canvasGraphSchema.safeParse(g).success).toBe(true);
  });

  it('条件节点的出边必须带 fromPort；带上就过', () => {
    const noPort = graph({
      nodes: [condNode('c'), node('t')],
      edges: [{ id: 'e', from: 'c', to: 't' }],
    });
    expect(validateGraph(noPort).some((p) => p.message.includes('没指明'))).toBe(true);

    const withPort = graph({
      nodes: [condNode('c'), node('t')],
      edges: [{ id: 'e', from: 'c', to: 't', fromPort: 'true' }],
    });
    expect(validateGraph(withPort)).toEqual([]);
  });

  it('同一个口连了不止一条线被拒；两个口各一条就合法', () => {
    const dup = graph({
      nodes: [condNode('c'), node('t'), node('u')],
      edges: [
        { id: 'e1', from: 'c', to: 't', fromPort: 'true' },
        { id: 'e2', from: 'c', to: 'u', fromPort: 'true' },
      ],
    });
    expect(validateGraph(dup).some((p) => p.message.includes('只能连一条'))).toBe(true);

    const ok = graph({
      nodes: [condNode('c'), node('t'), node('u')],
      edges: [
        { id: 'e1', from: 'c', to: 't', fromPort: 'true' },
        { id: 'e2', from: 'c', to: 'u', fromPort: 'false' },
      ],
    });
    expect(validateGraph(ok)).toEqual([]);
  });

  it('非条件节点的连线**不许**带 fromPort（端口是条件节点的语法）', () => {
    const g = graph({
      nodes: [node('a'), node('b')],
      edges: [{ id: 'e', from: 'a', to: 'b', fromPort: 'true' }],
    });
    expect(validateGraph(g).some((p) => p.message.includes('不是条件节点'))).toBe(true);
  });

  it('schema 层就拦下乱写的出口值（只能 true / false）', () => {
    const bad = {
      ...graph({ nodes: [condNode('c'), node('t')], edges: [] }),
      edges: [{ id: 'e', from: 'c', to: 't', fromPort: 'yes' }],
    };
    expect(canvasGraphSchema.safeParse(bad).success).toBe(false);
  });

  it('缺 prompt / 缺 keyword / 空 keyword 都被点名', () => {
    const noPrompt = graph({
      nodes: [{ id: 'c', kind: 'condition', x: 0, y: 0, config: { keyword: '好' } }],
      edges: [],
    });
    expect(validateGraph(noPrompt as CanvasGraph).some((p) => p.message.includes('缺少 prompt'))).toBe(true);

    const noKeyword = graph({
      nodes: [{ id: 'c', kind: 'condition', x: 0, y: 0, config: { prompt: 'p' } }],
      edges: [],
    });
    expect(validateGraph(noKeyword as CanvasGraph).some((p) => p.message.includes('keyword'))).toBe(true);

    const emptyKeyword = graph({
      nodes: [{ id: 'c', kind: 'condition', x: 0, y: 0, config: { prompt: 'p', keyword: '' } }],
      edges: [],
    });
    const problems = validateGraph(emptyKeyword as CanvasGraph);
    expect(problems.some((p) => p.message.includes('不能为空'))).toBe(true);
  });
});
