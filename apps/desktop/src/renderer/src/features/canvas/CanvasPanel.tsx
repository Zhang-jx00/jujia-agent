import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ViewportPortal,
  addEdge,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CANVAS_MAX_LOOP_ROUNDS,
  canvasGraphSchema,
  downstreamClosure,
  findCycle,
  type CanvasEventPayload,
  type CanvasGraph,
  type CanvasListItem,
} from '@jujia/shared-ipc';
import {
  CANVAS_GRID,
  planDragPosition,
  toFlowEdge,
  toFlowNode,
  toGraph,
  type AlignLine,
  type CanvasNodeData,
  type FlowNode,
  type Rect,
} from './canvas-bridge';
import { CommandPalette, type CanvasCommand } from './CommandPalette';

/**
 * 无限画布（M9a + B1）的界面层。
 *
 * 纪律写在这里：
 * 1. **图只是编排**：这个组件从不执行任何东西 —— 跑图只调 `canvasRun`，节点状态从事件里来；
 * 2. **事件按归属收**：`onCanvasEvent` 推来的是**所有**图的事件，这里只认 `graphId === 当前图`
 *    （T5"事件按会话分发"的推广；批复追加要求 a）；
 * 3. **连线先用同一套纯规则判**（`findCycle` / 自环 / 重复边）：界面即时反馈用的是
 *    与主进程保存前**同一个** `canvas-graph.ts`，不是另一份规则；
 * 4. **B1 的拖动/对齐/面板都只是"看得更顺"**：判定与吸附全在 `canvas-bridge.ts` 的纯函数里
 *    （**先网格、后对齐**），命令面板只是既有动作的**第二个入口**（与按钮共用同一批函数引用，接线锁钉住）。
 */

const NEW_GRAPH_ID = (): string => crypto.randomUUID();
const NODE_ID = (): string => `n-${Math.random().toString(36).slice(2, 8)}`;
/** 实测尺寸出来之前的兜底（对齐判定要用到宽高） */
const DEFAULT_SIZE = { width: 176, height: 64 };

const rectOf = (n: FlowNode): Rect => ({
  x: n.position.x,
  y: n.position.y,
  width: n.measured?.width ?? DEFAULT_SIZE.width,
  height: n.measured?.height ?? DEFAULT_SIZE.height,
});

/**
 * 节点卡片：把"哪个节点、什么状态、配的是什么"画在一张卡上（e2e 也靠这层文本断言）。
 *
 * B3 起卡片上有 **Handle**（连通口）：所有节点左侧一个入端、右侧出端；条件节点右侧是
 * **真 / 假两个口**（id 就是图契约里的 `fromPort`，`canvas-bridge.ts` 负责两个世界的名字互译）。
 * 补这一段的账：M9a 表里写过"连线"，但当时卡片上没有 Handle —— 界面根本拖不出线
 * （图一直是"写进盘再打开"验的）。条件节点的"两出口"没有可拖的口就是画着好看，
 * 所以这一笔在 B3 一并补上（纯界面，零执行语义）。
 */
function CanvasNodeCard({ data }: { data: CanvasNodeData }): ReactElement {
  const kindLabel =
    data.kind === 'prompt' ? '提示词' : data.kind === 'tool' ? '工具' : data.kind === 'condition' ? '条件' : '循环';
  const keyword = String(data.keywordText ?? '');
  const rounds = String(data.roundsText ?? '');
  return (
    <div className={`jj-canvas-node jj-canvas-node-${data.status}`} data-node-status={data.status}>
      <Handle type="target" position={Position.Left} />
      <div className="jj-canvas-node-kind">{kindLabel}</div>
      <div className="jj-canvas-node-body">{data.configText}</div>
      {data.kind === 'condition' && (
        <div className="jj-canvas-node-keyword">
          {keyword === '' ? '还没填判定关键词' : `含「${keyword}」走真口`}
        </div>
      )}
      {data.kind === 'loop' && (
        <div className="jj-canvas-node-keyword">
          {keyword === '' ? '还没填终止关键词' : `含「${keyword}」停 · 最多 ${rounds} 轮`}
        </div>
      )}
      <div className="jj-canvas-node-status">{data.status}</div>
      {/* B3b：最新一句运行说明（含"第几轮"）—— 事件里带过来的，卡片只负责显示 */}
      {typeof data.note === 'string' && data.note !== '' && (
        <div className="jj-canvas-node-note">{data.note}</div>
      )}
      {/* B2：局部重跑的"重跑段"小标（随下一次整图运行 / 重开图清掉） */}
      {data.rerun === true && (
        <div className="jj-canvas-node-rerun" data-rerun="1">
          ↻ 重跑
        </div>
      )}
      {data.kind === 'condition' ? (
        <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: '32%' }} />
          <Handle type="source" id="false" position={Position.Right} style={{ top: '72%' }} />
          <span className="jj-canvas-port-tag" data-port="true" style={{ top: '32%' }}>
            真
          </span>
          <span className="jj-canvas-port-tag" data-port="false" style={{ top: '72%' }}>
            假
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const NODE_TYPES = { default: CanvasNodeCard };

export function CanvasPanel(): ReactElement {
  const [graphId, setGraphId] = useState<string>(NEW_GRAPH_ID());
  const [saved, setSaved] = useState<CanvasListItem[]>([]);
  const [connections, setConnections] = useState<{ id: string; name: string }[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runState, setRunState] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const rfRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  /** B1：拖动时的对齐辅助线（只画不判，判定在纯函数里） */
  const [guides, setGuides] = useState<{ vertical: AlignLine | null; horizontal: AlignLine | null }>({
    vertical: null,
    horizontal: null,
  });
  /** B1：空白处右键的建节点菜单（屏幕坐标） */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /** 保存与运行都要用的当前图（纯函数，不做 IO） */
  const graph = useMemo(
    () => toGraph(nodes, edges, connectionId, viewportRef.current),
    [nodes, edges, connectionId],
  );

  const reload = useCallback(async (): Promise<void> => {
    const [list, conns] = await Promise.all([window.jujia.canvasList(), window.jujia.connectionList()]);
    setSaved(list.items);
    setConnections(conns.map((c) => ({ id: c.id, name: c.name })));
    if (connectionId === '' && conns.length > 0) setConnectionId(conns[0]?.id ?? '');
  }, [connectionId]);

  useEffect(() => {
    void reload().catch(() => undefined);
    // 只在挂载时列一次（保存后我们自己刷）
    // eslint 规则不在本仓的配置里，这里靠注释说明即可
  }, []);

  /**
   * 事件归属：**只认自己这张图的节点事件**（批复追加要求 a）。
   * 别的图在跑时事件照样会推过来 —— 不筛就是跨来源污染。
   */
  useEffect(() => {
    const off = window.jujia.onCanvasEvent((event: CanvasEventPayload) => {
      if (event.graphId !== graphId) return;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === event.nodeId
            ? { ...n, data: { ...n.data, status: event.status, note: event.note } }
            : n,
        ),
      );
      setRunState(`第 ${String(event.step)} 步：${event.nodeId} ${event.status}${event.note === '' ? '' : ` —— ${event.note}`}`);
    });
    return off;
  }, [graphId]);

  /** B1：Ctrl+K 打开命令面板（鼠标党走侧栏的按钮，两条路；e2e 从按钮进） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 连线合法性：与主进程保存前**同一套**规则（自环 / 重复 / 成环 / 条件出口占用） */
  const isValidConnection = useCallback(
    (c: Connection | Edge): boolean => {
      if (c.source === c.target) return false;
      if (edges.some((e) => e.source === c.source && e.target === c.target)) return false;
      // B3：条件节点的每个出口最多一条线（与保存前的 portKeys 规则同口径）
      if (
        (c.sourceHandle === 'true' || c.sourceHandle === 'false') &&
        edges.some((e) => e.source === c.source && e.sourceHandle === c.sourceHandle)
      ) {
        return false;
      }
      const probe: CanvasGraph = {
        ...toGraph(nodes, edges, connectionId, viewportRef.current),
        edges: [...edges.map((e) => ({ id: e.id, from: e.source, to: e.target })), { id: 'probe', from: c.source ?? '', to: c.target ?? '' }],
      };
      return findCycle(probe) === null;
    },
    [nodes, edges, connectionId],
  );

  const addNodeAt = (kind: 'prompt' | 'tool' | 'condition' | 'loop', at?: { x: number; y: number }): void => {
    const id = NODE_ID();
    const data: CanvasNodeData =
      kind === 'prompt'
        ? { kind, configText: '把下面这段压成三条要点', status: 'pending' }
        : kind === 'tool'
          ? { kind, configText: 'list_dir', status: 'pending' }
          : kind === 'loop'
            ? { kind, configText: '继续完善这段文字', keywordText: '完成', roundsText: '3', status: 'pending' }
            : { kind, configText: '判断一下', keywordText: '', status: 'pending' };
    setNodes((prev) => [
      ...prev,
      {
        id,
        position: at ?? { x: 80 + prev.length * 40, y: 80 + prev.length * 30 },
        data,
      },
    ]);
  };
  const addNode = (kind: 'prompt' | 'tool' | 'condition' | 'loop'): void => addNodeAt(kind);

  /**
   * B1：拖动位置 = **先网格、后对齐**（判定与吸附全在纯函数里）。
   * 关键教训（由 e2e 抓出，2026-10-06）：① 吸附必须在 `onNodesChange` 的位置变更里改
   * —— 写在 `onNodeDrag` 里的 setNodes 会被随后到来的位置变更覆盖；
   * ② **松手瞬间还会再来一条 `dragging:false` 的位置变更**（React Flow 的
   * `updateNodePositions(items, false)`），只改 `dragging:true` 的话，吸附结果会被它覆盖回纯网格值
   * （表现：A 停在 256 而不是对齐的 260）。所以：**凡带位置的位置变更，一律过规划** ——
   * 规划对新落点是幂等的（`plan(plan(p)) === plan(p)`，单测钉住）。
   */
  const applyDragChanges = (changes: NodeChange<FlowNode>[], prev: FlowNode[]): FlowNode[] => {
    const adjusted = changes.map((c) => {
      if (c.type === 'position' && c.position !== undefined) {
        const me = prev.find((n) => n.id === c.id);
        if (me === undefined) return c;
        const plan = planDragPosition(
          c.position,
          { width: me.measured?.width ?? DEFAULT_SIZE.width, height: me.measured?.height ?? DEFAULT_SIZE.height },
          prev.filter((n) => n.id !== c.id).map(rectOf),
          { grid: CANVAS_GRID },
        );
        return { ...c, position: { x: plan.x, y: plan.y } };
      }
      return c;
    });
    return applyNodeChanges(adjusted, prev);
  };

  /** B1：辅助线只画不判 —— 判在同一个纯函数里（此时 node.position 已是吸附后的落点，规划是幂等的） */
  const onNodeDrag = useCallback(
    (_event: unknown, node: FlowNode): void => {
      const plan = planDragPosition(
        node.position,
        { width: node.measured?.width ?? DEFAULT_SIZE.width, height: node.measured?.height ?? DEFAULT_SIZE.height },
        nodes.filter((n) => n.id !== node.id).map(rectOf),
        { grid: CANVAS_GRID },
      );
      setGuides({ vertical: plan.vertical, horizontal: plan.horizontal });
    },
    [nodes],
  );

  const onNodeDragStop = useCallback((): void => {
    setGuides({ vertical: null, horizontal: null });
  }, []);

  /** B1：空白处右键 → 菜单（菜单项的落点用屏幕坐标换算，不猜 viewport） */
  const onPaneContextMenu = (e: MouseEvent | ReactMouseEvent<Element>): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const createFromMenu = (kind: 'prompt' | 'tool' | 'condition' | 'loop'): void => {
    if (menu === null) return;
    const at = rfRef.current?.screenToFlowPosition({ x: menu.x, y: menu.y });
    setMenu(null);
    if (at !== undefined) addNodeAt(kind, at);
  };

  /** B1：双击空白处直接建一个提示词节点（落在双击点） */
  const onCanvasDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) return; // 双击节点/连线不算
    const at = rfRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (at !== undefined) addNodeAt('prompt', at);
  };

  const patchSelected = (patch: Partial<CanvasNodeData>): void => {
    if (selected === null) return;
    setNodes((prev) => prev.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await window.jujia.canvasSave(graphId, graph);
      setMsg(r.ok ? { kind: 'ok', text: `已保存（${graph.nodes.length} 个节点 / ${graph.edges.length} 条连线）` } : { kind: 'err', text: `${r.error}${r.problems.length > 0 ? `：${r.problems.join('；')}` : ''}` });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function load(id: string): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await window.jujia.canvasLoad(id);
      if (!r.ok) {
        setMsg({ kind: 'err', text: r.error });
        return;
      }
      const parsed = canvasGraphSchema.safeParse(r.graph);
      if (!parsed.success) {
        setMsg({ kind: 'err', text: '读回来的图不合法（不该发生，先别动它）' });
        return;
      }
      setGraphId(id);
      setConnectionId(parsed.data.connectionId);
      setNodes(parsed.data.nodes.map(toFlowNode));
      setEdges(parsed.data.edges.map(toFlowEdge));
      viewportRef.current = parsed.data.viewport;
      // T40：视口要真的回放 —— 旧写法只写 ref，等于写完没人看（React Flow 不知道）。
      // 下一帧再落：节点/边刚 set 进去，先让它渲染完，再把实例视口对准存下来的那一个。
      requestAnimationFrame(() => rfRef.current?.setViewport(viewportRef.current));
      setSelected(null);
      setMsg({ kind: 'ok', text: `已打开 ${id}` });
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    setBusy(true);
    setMsg(null);
    setRunState(null);
    try {
      // 先存再跑：跑的是**盘上**那张（主进程会重新加载并二次校验）
      const savedFirst = await window.jujia.canvasSave(graphId, graph);
      if (!savedFirst.ok) {
        setMsg({ kind: 'err', text: `先修好再跑：${savedFirst.error}` });
        return;
      }
      // 整图跑：状态与「重跑」标一起清（重跑段是"上一次局部重跑"的记号）
      setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: 'pending', rerun: false } })));
      const r = await window.jujia.canvasRun(graphId);
      // 数量按**节点数**说（回执行是步骤事件的条数，会多一倍 —— 两种说法别混用）；
      // B3：有被跳过的节点时**分开说** —— 把没跑的算进"跑完了"就是声称比事实多
      const total = graph.nodes.length;
      setMsg(
        r.ok
          ? {
              kind: 'ok',
              text:
                r.skipped === 0
                  ? `跑完了（${String(total)} 个节点）`
                  : `跑完了（${String(total)} 个节点：${String(total - r.skipped)} 个执行、${String(r.skipped)} 个被跳过）`,
            }
          : { kind: 'err', text: r.error },
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * B2 局部重跑：**同一个 `canvasRun` 入口**（多带一个起点参数）——
   * 范围 = 该节点 + 全部下游（`downstreamClosure`，与编排层同一份纯函数）；
   * 上游不动、不引入"过期"概念（旧状态直接重置重跑，运行历史本来就不持久化）。
   */
  async function runFrom(nodeId: string): Promise<void> {
    setBusy(true);
    setMsg(null);
    setRunState(null);
    try {
      const savedFirst = await window.jujia.canvasSave(graphId, graph);
      if (!savedFirst.ok) {
        setMsg({ kind: 'err', text: `先修好再跑：${savedFirst.error}` });
        return;
      }
      const scope = downstreamClosure(graph, nodeId);
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: { ...n.data, ...(scope?.has(n.id) === true ? { status: 'pending', rerun: true } : {}) },
        })),
      );
      const r = await window.jujia.canvasRun(graphId, nodeId);
      setMsg(
        r.ok
          ? {
              kind: 'ok',
              // 步数按**节点数**说（scope.size），不拿回执行数（那是步骤事件的条数，会多一倍）
              text: `从 ${nodeId} 重跑：${String(scope?.size ?? 0)} 个节点（该段已重置重跑；上游未动）`,
            }
          : { kind: 'err', text: r.error },
      );
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    await window.jujia.canvasStop(graphId);
  }

  /**
   * B1：命令面板的命令集 —— **只是既有动作的第二个入口**：
   * 每条 `run` 都调上面那两个函数（或 `addNode` / `rfRef.fitView`）的**同一个引用**，
   * 面板里没有任何新的 IPC / 执行调用（接线锁钉住）。
   */
  const paletteCommands: CanvasCommand[] = [
    { id: 'add-prompt', label: '添加提示词节点', run: () => addNode('prompt') },
    { id: 'add-tool', label: '添加工具节点', run: () => addNode('tool') },
    { id: 'add-condition', label: '添加条件节点', run: () => addNode('condition') },
    { id: 'add-loop', label: '添加循环节点', run: () => addNode('loop') },
    { id: 'save', label: '保存这张图', run: () => void save() },
    { id: 'run', label: '运行这张图', run: () => void run() },
    { id: 'stop', label: '停止', run: () => void stop() },
    { id: 'fit', label: 'FitView 适应视图', run: () => rfRef.current?.fitView() },
  ];

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="jj-canvas">
      <div className="jj-canvas-side">
        <div className="jj-canvas-group">
          <button type="button" className="w2-btn" onClick={() => addNode('prompt')}>
            + 提示词节点
          </button>
          <button type="button" className="w2-btn" onClick={() => addNode('tool')}>
            + 工具节点
          </button>
          <button type="button" className="w2-btn" onClick={() => addNode('condition')}>
            + 条件节点
          </button>
          <button type="button" className="w2-btn" onClick={() => addNode('loop')}>
            + 循环节点
          </button>
          <button type="button" className="w2-btn" onClick={() => setPaletteOpen(true)}>
            命令面板（Ctrl+K）
          </button>
        </div>

        <label>
          连接（图的模型走这一条）
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="jj-canvas-group">
          <button type="button" className="w2-btn-primary" disabled={busy} onClick={() => void run()}>
            运行这张图
          </button>
          <button type="button" className="w2-btn" disabled={busy} onClick={() => void stop()}>
            停止
          </button>
          <button type="button" className="w2-btn" disabled={busy} onClick={() => void save()}>
            保存
          </button>
        </div>

        <div>
          <p className="p0-subtitle">已保存的图</p>
          {saved.length === 0 && <p className="jj-muted">（还没有）</p>}
          {saved.map((s) => (
            <button
              key={s.id}
              type="button"
              className="jj-btn jj-btn-quiet jj-canvas-item"
              data-graph-id={s.id}
              title={s.id}
              onClick={() => void load(s.id)}
            >
              {`${s.name} · ${String(s.nodeCount)} 节点`}
            </button>
          ))}
        </div>

        {selectedNode !== null && (
          <div className="jj-canvas-group">
            <p className="p0-subtitle">{`节点 ${selectedNode.id}（${selectedNode.data.kind}）`}</p>
            <input
              aria-label="节点配置"
              value={selectedNode.data.configText}
              onChange={(e) => patchSelected({ configText: e.target.value })}
              placeholder={
                selectedNode.data.kind === 'prompt'
                  ? '提示词'
                  : selectedNode.data.kind === 'tool'
                    ? '工具名（如 list_dir）'
                    : selectedNode.data.kind === 'loop'
                      ? '每轮要问模型的提示词（重复直到命中终止词）'
                      : '提示词（拿去问模型，回答里找关键词）'
              }
            />
            {selectedNode.data.kind === 'tool' && (
              <input
                aria-label="工具参数"
                value={String(selectedNode.data['argsText'] ?? '{}')}
                onChange={(e) => patchSelected({ argsText: e.target.value } as Partial<CanvasNodeData>)}
                placeholder='参数 JSON，如 {"path": "."}'
              />
            )}
            {selectedNode.data.kind === 'condition' && (
              <input
                aria-label="判定关键词"
                value={String(selectedNode.data['keywordText'] ?? '')}
                onChange={(e) => patchSelected({ keywordText: e.target.value } as Partial<CanvasNodeData>)}
                placeholder="回答里含这个词就走 true 口"
              />
            )}
            {selectedNode.data.kind === 'loop' && (
              <>
                <input
                  aria-label="终止关键词"
                  value={String(selectedNode.data['keywordText'] ?? '')}
                  onChange={(e) => patchSelected({ keywordText: e.target.value } as Partial<CanvasNodeData>)}
                  placeholder="回答里含这个词就结束循环"
                />
                <input
                  aria-label="轮数上限"
                  value={String(selectedNode.data['roundsText'] ?? '')}
                  onChange={(e) => patchSelected({ roundsText: e.target.value } as Partial<CanvasNodeData>)}
                  placeholder={`1..${String(CANVAS_MAX_LOOP_ROUNDS)} 的整数（每轮都是一次真实调用）`}
                />
              </>
            )}
            {/* B2：局部重跑入口 —— 走的是与「运行这张图」同一个 canvasRun（多带一个起点） */}
            <button
              type="button"
              className="w2-btn"
              disabled={busy}
              onClick={() => void runFrom(selectedNode.id)}
            >
              从此节点重跑
            </button>
          </div>
        )}

        {runState !== null && <p className="jj-ok">{runState}</p>}
        {msg !== null && (
          <p className={msg.kind === 'ok' ? 'jj-ok' : 'p0-err'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="jj-canvas-main" aria-label="画布" onDoubleClick={onCanvasDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes: NodeChange<FlowNode>[]) => setNodes((prev) => applyDragChanges(changes, prev))}
          onEdgesChange={(changes: EdgeChange[]) => setEdges((prev) => applyEdgeChanges(changes, prev))}
          onConnect={(c: Connection) => {
            if (!isValidConnection(c)) {
              setMsg({ kind: 'err', text: '这条连线不行：自环 / 重复 / 会连成环' });
              return;
            }
            setEdges((prev) => addEdge({ ...c, id: `e-${Math.random().toString(36).slice(2, 8)}` }, prev));
          }}
          onNodeClick={(_e, n) => setSelected(n.id)}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => setMenu(null)}
          onPaneContextMenu={onPaneContextMenu}
          onInit={(instance: ReactFlowInstance<FlowNode, Edge>) => {
            rfRef.current = instance;
          }}
          onMoveEnd={(_e, vp) => {
            viewportRef.current = { x: vp.x, y: vp.y, zoom: vp.zoom };
          }}
          nodeTypes={NODE_TYPES}
          nodesDraggable
          snapToGrid
          snapGrid={[CANVAS_GRID, CANVAS_GRID]}
          zoomOnDoubleClick={false}
          fitView
        >
          <Background />
          <Controls />
          <ViewportPortal>
            {guides.vertical !== null && (
              <div
                className="jj-align-line"
                data-align="v"
                style={{
                  left: guides.vertical.pos,
                  top: guides.vertical.from,
                  height: Math.max(guides.vertical.to - guides.vertical.from, 1),
                }}
              />
            )}
            {guides.horizontal !== null && (
              <div
                className="jj-align-line"
                data-align="h"
                style={{
                  top: guides.horizontal.pos,
                  left: guides.horizontal.from,
                  width: Math.max(guides.horizontal.to - guides.horizontal.from, 1),
                }}
              />
            )}
          </ViewportPortal>
        </ReactFlow>
        {menu !== null && (
          <div className="jj-canvas-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" role="menuitem" onClick={() => createFromMenu('prompt')}>
              加一个提示词节点
            </button>
            <button type="button" role="menuitem" onClick={() => createFromMenu('tool')}>
              加一个工具节点
            </button>
            <button type="button" role="menuitem" onClick={() => createFromMenu('condition')}>
              加一个条件节点
            </button>
          </div>
        )}
      </div>

      <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
