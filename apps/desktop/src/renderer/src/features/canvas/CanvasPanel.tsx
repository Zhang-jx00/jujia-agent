import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  canvasGraphSchema,
  findCycle,
  type CanvasEventPayload,
  type CanvasGraph,
  type CanvasListItem,
} from '@jujia/shared-ipc';
import {
  toFlowEdge,
  toFlowNode,
  toGraph,
  type CanvasNodeData,
  type FlowNode,
} from './canvas-bridge';

/**
 * 无限画布（M9a）的界面层。
 *
 * 三条纪律写在这里：
 * 1. **图只是编排**：这个组件从不执行任何东西 —— 跑图只调 `canvasRun`，节点状态从事件里来；
 * 2. **事件按归属收**：`onCanvasEvent` 推来的是**所有**图的事件，这里只认 `graphId === 当前图`
 *    （T5"事件按会话分发"的推广；批复追加要求 a）；
 * 3. **连线先用同一套纯规则判**（`findCycle` / 自环 / 重复边）：界面即时反馈用的是
 *    与主进程保存前**同一个** `canvas-graph.ts`，不是另一份规则。
 */

const NEW_GRAPH_ID = (): string => crypto.randomUUID();
const NODE_ID = (): string => `n-${Math.random().toString(36).slice(2, 8)}`;

/** 节点卡片：把"哪个节点、什么状态、配的是什么"画在一张卡上（e2e 也靠这层文本断言） */
function CanvasNodeCard({ data }: { data: CanvasNodeData }): ReactElement {
  return (
    <div className={`jj-canvas-node jj-canvas-node-${data.status}`} data-node-status={data.status}>
      <div className="jj-canvas-node-kind">{data.kind === 'prompt' ? '提示词' : '工具'}</div>
      <div className="jj-canvas-node-body">{data.configText}</div>
      <div className="jj-canvas-node-status">{data.status}</div>
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
          n.id === event.nodeId ? { ...n, data: { ...n.data, status: event.status } } : n,
        ),
      );
      setRunState(`第 ${String(event.step)} 步：${event.nodeId} ${event.status}${event.note === '' ? '' : ` —— ${event.note}`}`);
    });
    return off;
  }, [graphId]);

  /** 连线合法性：与主进程保存前**同一套**规则（自环 / 重复 / 成环） */
  const isValidConnection = useCallback(
    (c: Connection | Edge): boolean => {
      if (c.source === c.target) return false;
      if (edges.some((e) => e.source === c.source && e.target === c.target)) return false;
      const probe: CanvasGraph = {
        ...toGraph(nodes, edges, connectionId, viewportRef.current),
        edges: [...edges.map((e) => ({ id: e.id, from: e.source, to: e.target })), { id: 'probe', from: c.source ?? '', to: c.target ?? '' }],
      };
      return findCycle(probe) === null;
    },
    [nodes, edges, connectionId],
  );

  const addNode = (kind: 'prompt' | 'tool'): void => {
    const id = NODE_ID();
    setNodes((prev) => [
      ...prev,
      {
        id,
        position: { x: 80 + prev.length * 40, y: 80 + prev.length * 30 },
        data: { kind, configText: kind === 'prompt' ? '把下面这段压成三条要点' : 'list_dir', status: 'pending' },
      },
    ]);
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
      setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: 'pending' } })));
      const r = await window.jujia.canvasRun(graphId);
      setMsg(r.ok ? { kind: 'ok', text: `跑完了（${r.steps.length} 步）` } : { kind: 'err', text: r.error });
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    await window.jujia.canvasStop(graphId);
  }

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
              placeholder={selectedNode.data.kind === 'prompt' ? '提示词' : '工具名（如 list_dir）'}
            />
            {selectedNode.data.kind === 'tool' && (
              <input
                aria-label="工具参数"
                value={String(selectedNode.data['argsText'] ?? '{}')}
                onChange={(e) => patchSelected({ argsText: e.target.value } as Partial<CanvasNodeData>)}
                placeholder='参数 JSON，如 {"path": "."}'
              />
            )}
          </div>
        )}

        {runState !== null && <p className="jj-ok">{runState}</p>}
        {msg !== null && (
          <p className={msg.kind === 'ok' ? 'jj-ok' : 'p0-err'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="jj-canvas-main" aria-label="画布">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes: NodeChange<FlowNode>[]) => setNodes((prev) => applyNodeChanges(changes, prev))}
          onEdgesChange={(changes: EdgeChange[]) => setEdges((prev) => applyEdgeChanges(changes, prev))}
          onConnect={(c: Connection) => {
            if (!isValidConnection(c)) {
              setMsg({ kind: 'err', text: '这条连线不行：自环 / 重复 / 会连成环' });
              return;
            }
            setEdges((prev) => addEdge({ ...c, id: `e-${Math.random().toString(36).slice(2, 8)}` }, prev));
          }}
          onNodeClick={(_e, n) => setSelected(n.id)}
          onMoveEnd={(_e, vp) => {
            viewportRef.current = { x: vp.x, y: vp.y, zoom: vp.zoom };
          }}
          nodeTypes={NODE_TYPES}
          nodesDraggable
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
