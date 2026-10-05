import { topoOrder, type CanvasGraph, type CanvasNode } from './canvas-graph';

/**
 * 画布执行器的**编排层**（M9a）
 *
 * 为什么住在 shared-ipc 而不是 agent-core：这块编排**一个 IO 都不碰**（依赖全由调用方注入），
 * 而 agent-core 目前只依赖 zod、没有引 shared-ipc 的运行时依赖 —— 把它放 agent-core 就要动
 * 依赖方向。放这里两个包都能用，方向也不用动（shared-ipc 只依赖 zod）：拓扑顺序、逐个调度、状态机、取消传播、步数上界。
 *
 * 为什么不把这段写进主进程的 runner：`chat-service` 的教训 —— 依赖 electron 的模块在 vitest 里
 * 根本加载不了，于是判断全躲在只有 e2e 碰得到的地方。这里的编排**不碰任何 IO**：
 * 真正执行一个节点的能力由调用方以 `execute(node)` 注入（主进程注入 `runTool` 与 provider 层，
 * 测试注入假执行器）。于是"顺序对不对、被拒之后停不停、取消传不传得下去"全部可单测。
 *
 * **它自己不执行任何东西**：没有 fetch、没有 provider、没有 fs —— 接线锁会钉住这一点
 * （批复要点①：执行只经 runTool 与 agent-loop 那条链路）。
 */

export type NodeStatus = 'pending' | 'running' | 'ok' | 'failed' | 'denied' | 'cancelled';

export interface NodeResult {
  ok: boolean;
  /** 成功时的产出文本（提示词=模型回复；工具=工具输出） */
  output: string;
  /** 失败 / 被拒时的说明（必须能给人看） */
  error: string;
  /** 是否"用户拒绝"而不是"执行出错"（界面上是两种状态） */
  denied?: boolean;
}

export interface RunEvent {
  nodeId: string;
  status: NodeStatus;
  /** 走到第几个（从 1 数；0 = 还没开始） */
  step: number;
  /** 状态变化时的一句话（成功给摘要、失败给原因） */
  note: string;
}

export interface RunOutcome {
  /** 每个节点最终的状态（含被取消那些逐一的写法） */
  states: Record<string, NodeStatus>;
  /** 按执行顺序记的步骤（给界面画时间线、给 e2e 当"真的跑了三步"的证据） */
  steps: RunEvent[];
  /** 整体结论：完成 / 中途失败 / 被取消 */
  reason: 'done' | 'failed' | 'cancelled';
}

export interface RunOptions {
  /** 单次执行的节点数上限（来自 shared-ipc 的常量，调用方传） */
  maxSteps: number;
  /** 注入的执行能力：**唯一**执行节点的地方 */
  execute: (node: CanvasNode, signal: AbortSignal) => Promise<NodeResult>;
  /** 事件回调（每个节点状态变化都发一次） */
  onEvent?: (event: RunEvent) => void;
  /** 取消信号 */
  signal?: AbortSignal;
}

/**
 * 按拓扑序跑一遍图。
 *
 * 三条口径写死在这里（都是"错了会静默出事"的类型）：
 * 1. **有环不跑**：拓扑序排不出来就整体拒绝，不"尽力而为地跑一部分"；
 * 2. **被拒 = 停**：工具节点被用户拒绝（denied）与执行失败一样会中止后续节点 ——
 *    图是一串依赖，前一步没做成就往下跑，等于拿半成品当输入；
 * 3. **取消要传下去**：外部 abort 之后当前节点会被 abort 信号打断，剩下的节点标 `cancelled`
 *    （不是留在 pending 里让人以为"还没跑"）。
 */
const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

export async function runGraph(graph: CanvasGraph, options: RunOptions): Promise<RunOutcome> {
  const order = topoOrder(graph);
  const states: Record<string, NodeStatus> = {};
  for (const n of graph.nodes) states[n.id] = 'pending';
  const steps: RunEvent[] = [];

  if (order === null) {
    // 有环：整体拒绝（这里是最后一道保险；界面与保存前也会拦）
    for (const n of graph.nodes) states[n.id] = 'failed';
    return { states, steps, reason: 'failed' };
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const emit = (nodeId: string, status: NodeStatus, step: number, note: string): void => {
    states[nodeId] = status;
    // 事件里**只有节点**：图的归属（graphId）由调用方补 —— 编排层不该假装知道自己是哪张图
    const event: RunEvent = { nodeId, status, step, note };
    steps.push(event);
    options.onEvent?.(event);
  };

  if (order.length > options.maxSteps) {
    for (const id of order) emit(id, 'failed', 0, `超过单次执行的节点数上限（${String(options.maxSteps)}）`);
    return { states, steps, reason: 'failed' };
  }

  let step = 0;
  for (const id of order) {
    if (isAborted(options.signal)) {
      emit(id, 'cancelled', step, '已取消');
      continue;
    }
    const node = byId.get(id);
    if (node === undefined) continue;
    step += 1;
    emit(id, 'running', step, '开始执行');
    try {
      const result = await options.execute(node, options.signal ?? new AbortController().signal);
      if (result.denied === true) {
        emit(id, 'denied', step, result.error === '' ? '用户拒绝了这一步' : result.error);
        return { states, steps, reason: 'failed' };
      }
      if (!result.ok) {
        emit(id, 'failed', step, result.error === '' ? '执行失败（没说原因）' : result.error);
        return { states, steps, reason: 'failed' };
      }
      emit(id, 'ok', step, result.output.slice(0, 200));
    } catch (err) {
      // 被取消与真失败要分开：前者不是错，不该让人以为工具坏了
      if (isAborted(options.signal)) {
        emit(id, 'cancelled', step, '已取消');
        return { states, steps, reason: 'cancelled' };
      }
      emit(id, 'failed', step, err instanceof Error ? err.message : String(err));
      return { states, steps, reason: 'failed' };
    }
  }

  // 有节点是"被取消"的，整体结论就不能写 done —— 那会让人以为整张图跑完了
  const cancelled = Object.values(states).some((st) => st === 'cancelled');
  return { states, steps, reason: cancelled ? 'cancelled' : 'done' };
}

/** 给界面/日志用的一句话摘要（"3 步完成 / 第 2 步被拒"） */
export function summarizeRun(outcome: RunOutcome): string {
  const done = outcome.steps.filter((s) => s.status === 'ok').length;
  if (outcome.reason === 'done') return `${String(done)} 步全部完成`;
  const failed = outcome.steps.find((s) => s.status === 'failed' || s.status === 'denied');
  if (outcome.reason === 'cancelled') return `已取消（完成 ${String(done)} 步）`;
  return failed === undefined
    ? '中途失败'
    : `第 ${String(failed.step)} 步${failed.status === 'denied' ? '被拒' : '失败'}：${failed.note}`;
}
