import {
  CANVAS_LOOP_TIME_LIMIT_MS,
  CANVAS_MAX_LOOP_ROUNDS,
  downstreamClosure,
  topoOrder,
  type CanvasGraph,
  type CanvasNode,
} from './canvas-graph';

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

export type NodeStatus = 'pending' | 'running' | 'ok' | 'failed' | 'denied' | 'cancelled' | 'skipped';

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
  /**
   * **局部重跑**（B2）：只跑"该节点 + 全部下游（闭包，含自身）"，其余节点不执行、不发事件、
   * 不进 `states`（"没动"与"跑了"是两种事实，混在一起界面就画错了）。不传 = 整图。
   * 指向不存在的节点 = **整体拒绝**（绝不"那就跑整图"）。
   */
  startFrom?: string;
  /**
   * 时钟（B3b：循环的时间上界要可测）。缺省 `Date.now`。
   * 注入的是**单调用途**（只做差值比较），调用方不需要提供真的单调钟。
   */
  now?: () => number;
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
 *
 * B3 追加两条（条件分支；都是"错了会静默出错"的同一类）：
 * 4. **判定在纯层**：命中与否 = `回答.includes(keyword)` —— 与拓扑序、闭包同处一个层级；
 *    执行器对条件节点与提示词节点走**同一条**单轮补全路径（那边没有第二套判定）；
 * 5. **`skipped` 既不是取消也不是失败**：未选的口不传播 —— 那一支和它的下游都不执行、
 *    状态写 `skipped`、**不占步号**，整体结论照旧可以是 `done`；取消（abort）优先于跳过。
 */
const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

export async function runGraph(graph: CanvasGraph, options: RunOptions): Promise<RunOutcome> {
  const order = topoOrder(graph);
  const states: Record<string, NodeStatus> = {};
  const steps: RunEvent[] = [];

  if (order === null) {
    // 有环：整体拒绝（这里是最后一道保险；界面与保存前也会拦）
    for (const n of graph.nodes) states[n.id] = 'failed';
    return { states, steps, reason: 'failed' };
  }

  /** B2：本次要跑的名单 —— 整图 = 拓扑序；局部重跑 = 闭包内的节点（其余**不动**：不执行/不发事件/不进 states） */
  let runList = order;
  if (options.startFrom !== undefined) {
    const scope = downstreamClosure(graph, options.startFrom);
    if (scope === null) {
      // 防御：主进程的 runner 会先给出更具体的说法；这里绝不"那就跑整图"
      for (const n of graph.nodes) states[n.id] = 'failed';
      return { states, steps, reason: 'failed' };
    }
    runList = order.filter((id) => scope.has(id));
  }
  for (const id of runList) states[id] = 'pending';

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  /**
   * B3：活路判定的三张表 ——
   * `incoming` 每个节点的入边（**来自名单之外的入边不参与判定**：局部重跑里"上游未动"）；
   * `selected` 条件节点实际走的口（执行完才写；被跳过的节点永远不写）；
   * `alive` 会真的执行的节点（存在一条从根起、沿途条件都选对了的"活路"）。
   */
  const runSet = new Set(runList);
  const incoming = new Map<string, { from: string; fromPort?: 'true' | 'false' }[]>();
  for (const e of graph.edges) {
    const list = incoming.get(e.to);
    const item = e.fromPort === undefined ? { from: e.from } : { from: e.from, fromPort: e.fromPort };
    if (list === undefined) incoming.set(e.to, [item]);
    else list.push(item);
  }
  const selected = new Map<string, 'true' | 'false'>();
  const alive = new Set<string>();

  const emit = (nodeId: string, status: NodeStatus, step: number, note: string): void => {
    states[nodeId] = status;
    // 事件里**只有节点**：图的归属（graphId）由调用方补 —— 编排层不该假装知道自己是哪张图
    const event: RunEvent = { nodeId, status, step, note };
    steps.push(event);
    options.onEvent?.(event);
  };

  // 上界按**本次要跑的名单**算（局部重跑只跑一段，不该拿全图节点数判它超限）。
  // 条件分支下名单里可能有最终被跳过的节点：事前不知道走哪边，只能按最坏情形（全跑）判 —— 宁可保守。
  if (runList.length > options.maxSteps) {
    for (const id of runList) emit(id, 'failed', 0, `超过单次执行的节点数上限（${String(options.maxSteps)}）`);
    return { states, steps, reason: 'failed' };
  }

  let step = 0;
  const now = options.now ?? Date.now;
  for (const id of runList) {
    // 取消优先于跳过：abort 之后剩下的节点是 cancelled，不按"分支没走"处理
    if (isAborted(options.signal)) {
      emit(id, 'cancelled', step, '已取消');
      continue;
    }
    const node = byId.get(id);
    if (node === undefined) continue;

    // B3 活路判定：名单外来的入边不参与；名单内要求"来源活着且在有效路径上"
    const fromInside = (incoming.get(id) ?? []).filter((e) => runSet.has(e.from));
    const live =
      fromInside.length === 0 ||
      fromInside.some((e) => {
        if (!alive.has(e.from)) return false;
        const src = byId.get(e.from);
        return src?.kind !== 'condition' || selected.get(e.from) === e.fromPort;
      });
    if (!live) {
      // 跳过不是取消也不是失败：它连跑都没轮到（整体结论照旧可以是 done）。不占步号。
      emit(id, 'skipped', step, '被跳过（上游分支没走这边）');
      continue;
    }
    alive.add(id);
    step += 1;

    // 兜底：没有可判定的关键词就**停下**（保存前本会拦）—— 绝不拿空关键词当"总走真口"
    if (node.kind === 'condition' && (typeof node.config['keyword'] !== 'string' || node.config['keyword'] === '')) {
      emit(id, 'failed', step, '条件节点没有可用的判定关键词（保存前本会拦；这是兜底，绝不默认走真口）');
      return { states, steps, reason: 'failed' };
    }
    // 兜底（B3b）：循环配置不完整就**停下** —— 绝不默认跑某一轮数、也绝不把空终止词当"每轮都停"
    if (node.kind === 'loop') {
      const kw = node.config['stopKeyword'];
      const rounds = node.config['maxRounds'];
      const okKeyword = typeof kw === 'string' && kw !== '';
      const okRounds =
        typeof rounds === 'number' &&
        Number.isInteger(rounds) &&
        rounds >= 1 &&
        rounds <= CANVAS_MAX_LOOP_ROUNDS;
      if (!okKeyword || !okRounds) {
        emit(id, 'failed', step, '循环节点配置不完整（保存前本会拦；这是兜底，绝不默认跑某一轮数）');
        return { states, steps, reason: 'failed' };
      }
    }

    emit(id, 'running', step, '开始执行');
    try {
      const signal = options.signal ?? new AbortController().signal;

      /**
       * B3b：循环节点 —— **每一轮都还是那一次 `execute`**（执行器对 loop 零特判；
       * 主进程侧就是与对话同一个 provider 流层）。三条口径：命中终止词提前停；
       * 轮数 / 时间任一上界到了就**失败**（不是成功、不是静默截断）；每一轮发进度事件。
       */
      if (node.kind === 'loop') {
        const stopKeyword = String(node.config['stopKeyword']);
        const maxRounds = Number(node.config['maxRounds']);
        const startedAt = now();
        let completed = 0;
        let met = false;
        for (let round = 1; round <= maxRounds; round += 1) {
          // 取消优先：轮与轮之间收到 abort，剩下的按 cancelled 收尾（与节点间口径一致）
          if (isAborted(options.signal)) {
            emit(id, 'cancelled', step, '已取消');
            return { states, steps, reason: 'cancelled' };
          }
          if (now() - startedAt >= CANVAS_LOOP_TIME_LIMIT_MS) {
            emit(
              id,
              'failed',
              step,
              `已到时间上界（${String(Math.round(CANVAS_LOOP_TIME_LIMIT_MS / 1000))} 秒）—— 第 ${String(completed)} 轮跑完后停下，仍未命中「${stopKeyword}」`,
            );
            return { states, steps, reason: 'failed' };
          }
          emit(id, 'running', step, `第 ${String(round)}/${String(maxRounds)} 轮`);
          const roundResult = await options.execute(node, signal);
          if (roundResult.denied === true) {
            emit(id, 'denied', step, roundResult.error === '' ? '用户拒绝了这一步' : roundResult.error);
            return { states, steps, reason: 'failed' };
          }
          if (!roundResult.ok) {
            emit(
              id,
              'failed',
              step,
              `第 ${String(round)} 轮：${roundResult.error === '' ? '执行失败（没说原因）' : roundResult.error}`,
            );
            return { states, steps, reason: 'failed' };
          }
          completed = round;
          if (roundResult.output.includes(stopKeyword)) {
            met = true;
            emit(id, 'ok', step, `第 ${String(round)} 轮命中「${stopKeyword}」→ 循环结束（共 ${String(round)} 轮）`);
            break;
          }
        }
        if (!met) {
          emit(
            id,
            'failed',
            step,
            `已到轮次上限（${String(maxRounds)} 轮）仍未命中「${stopKeyword}」—— 循环停止（这是到界，不是执行出错）`,
          );
          return { states, steps, reason: 'failed' };
        }
        continue;
      }

      const result = await options.execute(node, signal);
      if (result.denied === true) {
        emit(id, 'denied', step, result.error === '' ? '用户拒绝了这一步' : result.error);
        return { states, steps, reason: 'failed' };
      }
      if (!result.ok) {
        emit(id, 'failed', step, result.error === '' ? '执行失败（没说原因）' : result.error);
        return { states, steps, reason: 'failed' };
      }
      if (node.kind === 'condition') {
        // B3：判定就在这一处（纯规则）—— 执行器只负责产出回答，不参与判定
        const keyword = String(node.config['keyword']);
        const branch: 'true' | 'false' = result.output.includes(keyword) ? 'true' : 'false';
        selected.set(id, branch);
        emit(
          id,
          'ok',
          step,
          branch === 'true' ? `命中关键词「${keyword}」→ 走 true 口` : `没命中关键词「${keyword}」→ 走 false 口`,
        );
      } else {
        emit(id, 'ok', step, result.output.slice(0, 200));
      }
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

/** 给界面/日志用的一句话摘要（"3 步完成 / 第 2 步被拒 / 跳过 1 个"） */
export function summarizeRun(outcome: RunOutcome): string {
  const done = outcome.steps.filter((s) => s.status === 'ok').length;
  const skipped = outcome.steps.filter((s) => s.status === 'skipped').length;
  if (outcome.reason === 'done') {
    // 被跳过的**不算完成数**：写进"全部完成"会让人以为整张图都跑过
    return skipped === 0 ? `${String(done)} 步全部完成` : `${String(done)} 步完成，跳过 ${String(skipped)} 个`;
  }
  const failed = outcome.steps.find((s) => s.status === 'failed' || s.status === 'denied');
  if (outcome.reason === 'cancelled') return `已取消（完成 ${String(done)} 步）`;
  return failed === undefined
    ? '中途失败'
    : `第 ${String(failed.step)} 步${failed.status === 'denied' ? '被拒' : '失败'}：${failed.note}`;
}
