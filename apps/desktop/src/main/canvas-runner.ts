import {
  CANVAS_MAX_CONFIG_BYTES,
  CANVAS_MAX_RUN_STEPS,
  runGraph,
  summarizeRun,
  type CanvasEventPayload,
  type CanvasGraph,
  type CanvasNode,
  type CanvasRunResult,
  type NodeResult,
} from '@jujia/shared-ipc';
import {
  runTool,
  streamChat,
  type HookRunner,
  type PermissionResolver,
  type ToolRegistry,
} from '@jujia/agent-core';
import type { IpcPolicy } from './ipc/context';

/**
 * 画布执行器的**主进程侧**（M9a）：把编排层（`canvas-run.ts`）要的两样东西接上真实链路 ——
 *
 * - **工具节点** → `runTool`：与对话、手动执行**同一个注册表 + 同一个权限门**（批复要点①）。
 *   图执行期间的审批弹窗照常出现；用户拒绝 → 节点状态是 `denied`（不是普通失败，也不静默跳过）。
 * - **提示词 / 条件节点** → 与对话**同一个 provider 流式层**（`streamChat`）：单轮补全，
 *   用图自己的 `connectionId`（密钥仍在密钥库，图里只有 id）。
 *   条件节点的"走 true 还是 false"**不在这里判** —— 判定在编排层（`canvas-run.ts`，纯规则），
 *   这一层只负责把回答原样交出去（两个节点类型的执行是同一条代码路径，没有第二套）。
 *
 * 这个文件是"唯一允许把两者接起来"的地方 —— 接线锁会钉住：编排层不许自己引 provider / fetch / fs。
 */

export interface CanvasRunnerDeps {
  /** 当前工作区根（工具路径守卫用；null = 没选，工具会被拒） */
  getWorkspaceRoot: () => Promise<string | null>;
  /** 权限策略（每次现读：改了配置立刻生效） */
  loadPolicy: () => Promise<IpcPolicy>;
  /** 审批桥 —— 与工具执行共用同一条通道、同一个弹窗 */
  permission: PermissionResolver;
  /** 工具注册表（内置 + 已批准的 MCP） */
  registry: ToolRegistry;
  /** 连接解析（与对话同一处；密钥只在这里出现，进不了图 JSON） */
  resolveConnection: (id: string) => Promise<{ record: { baseUrl: string; model: string }; apiKey: string }>;
  /** 钩子运行器（工具执行同样要过钩子 —— 与对话/手动执行同一份） */
  hooks: HookRunner;
  /** 事件出口（带**归属**：graphId + nodeId） */
  emit: (event: CanvasEventPayload) => void;
  /** 测试用：覆盖 fetch */
  fetcher?: typeof fetch;
}

export interface CanvasRunner {
  /**
   * 跑一张图。**同一方法两用**（B2 硬要求：不许第二套执行路径）：
   * `fromNodeId` 缺省 = 整图；带上 = 局部重跑（该节点 + 全部下游）。
   */
  run(graphId: string, graph: CanvasGraph, fromNodeId?: string): Promise<CanvasRunResult>;
  /** 停止一张正在跑的图（返回"是不是真的停了"） */
  stop(graphId: string): boolean;
  running(): string[];
}

/** 工具节点里的 argsText 是 JSON 文本：解析失败要**说清楚**，不能让整张图莫名失败 */
function parseArgs(text: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, args: {} };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '参数要是 JSON 对象（形如 {"path": "."}）' };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: `参数不是合法 JSON：${err instanceof Error ? err.message : String(err)}` };
  }
}

export function createCanvasRunner(deps: CanvasRunnerDeps): CanvasRunner {
  const controllers = new Map<string, AbortController>();

  return {
    running: () => [...controllers.keys()],

    stop(graphId) {
      const controller = controllers.get(graphId);
      if (controller === undefined) return false;
      controller.abort();
      return true;
    },

    async run(graphId, graph, fromNodeId) {
      if (controllers.has(graphId)) {
        return { ok: false, reason: null, error: '这张图正在跑（先停止或等它跑完）', steps: [], skipped: 0 };
      }
      // B2 局部重跑：起点必须是图里的节点 —— 明确说话，绝不"那就整图跑"
      if (fromNodeId !== undefined && !graph.nodes.some((n) => n.id === fromNodeId)) {
        return { ok: false, reason: null, error: `图里没有这个节点：${fromNodeId}`, steps: [], skipped: 0 };
      }
      const controller = new AbortController();
      controllers.set(graphId, controller);

      const workspaceRoot = (await deps.getWorkspaceRoot()) ?? '__no_workspace__';
      const policy = await deps.loadPolicy();

      /** 唯一的执行入口：两种节点各自接上既有链路，别的什么都不做 */
      const execute = async (node: CanvasNode, signal: AbortSignal): Promise<NodeResult> => {
        if (node.kind === 'tool') {
          const toolName = String(node.config['toolName'] ?? '');
          const tool = deps.registry.get(toolName);
          if (tool === undefined) {
            return { ok: false, output: '', error: `没有这个工具：${toolName}` };
          }
          const parsed = parseArgs(String(node.config['argsText'] ?? '{}'));
          if (!parsed.ok) return { ok: false, output: '', error: parsed.error };

          const res = await runTool(tool, parsed.args, { workspaceRoot }, deps.permission, {
            mode: policy.mode,
            rules: policy.rules,
            alwaysAsk: policy.alwaysAsk,
            hooks: deps.hooks,
            // 与手动执行同一口径：**不带**会话级"总是允许"白名单（图执行不是某个会话）
            sessionId: 'canvas',
          });
          if (res.decision === 'deny') {
            return { ok: false, output: '', error: `用户拒绝了这一步（${toolName}）`, denied: true };
          }
          if (res.decision === 'timeout') {
            return { ok: false, output: '', error: `等待确认超时（${toolName}），这一步没有执行` };
          }
          return {
            ok: res.outcome.ok,
            output: res.outcome.ok ? res.outcome.content : '',
            error: res.outcome.ok ? '' : res.outcome.content,
          };
        }

        // 提示词 / 条件节点：单轮补全，走与对话同一个 provider 流式层
        // （条件节点的分支判定**不在这里** —— 判定在编排层，这一层只把回答交出去）
        const prompt = String(node.config['prompt'] ?? '');
        let text = '';
        let aborted = false;
        const { record, apiKey } = await deps.resolveConnection(graph.connectionId);
        for await (const ev of streamChat(
          {
            baseUrl: record.baseUrl,
            apiKey,
            model: record.model,
            messages: [{ role: 'user', content: prompt }],
            signal,
          },
          deps.fetcher === undefined ? {} : { fetcher: deps.fetcher },
        )) {
          if (ev.type === 'text_delta') text += ev.delta;
          // 用户停止是**正常路径**（streamChat 产 done(aborted) 而不抛错）——
          // 但它绝不能把半截回答当成功（复核 047 实验抓到的静默错报）
          if (ev.type === 'done' && ev.reason === 'aborted') aborted = true;
        }
        if (aborted) {
          // 抛出去让编排层按"信号已中止"归到 cancelled —— 与"执行出错"是两种状态
          throw new Error('用户停止了这一步（不把半截回答当结果）');
        }
        const oneLine = text.replace(/\s+/g, ' ').trim();
        if (oneLine === '') {
          return { ok: false, output: '', error: '模型没有返回内容（无密钥 / 超时 / 额度不足都可能）' };
        }
        return { ok: true, output: oneLine, error: '' };
      };

      try {
        const outcome = await runGraph(graph, {
          maxSteps: CANVAS_MAX_RUN_STEPS,
          execute,
          signal: controller.signal,
          // B2：起点缺省 = 整图（exactOptionalPropertyTypes 下不能塞 undefined，条件展开）
          ...(fromNodeId === undefined ? {} : { startFrom: fromNodeId }),
          onEvent: (e) => {
            // **归属在这里补上**：编排层只认识节点，graphId 是这一层的知识（批复要求 a）
            deps.emit({ graphId, nodeId: e.nodeId, status: e.status, step: e.step, note: e.note });
          },
        });
        return {
          ok: outcome.reason === 'done',
          reason: outcome.reason,
          error: outcome.reason === 'done' ? '' : summarizeRun(outcome),
          steps: outcome.steps.map((s) => `${String(s.step)}. ${s.nodeId} ${s.status} ${s.note}`),
          // B3：被跳过（未选分支及下游）的节点数 —— 界面用它说"几个执行、几个被跳过"
          skipped: Object.values(outcome.states).filter((s) => s === 'skipped').length,
        };
      } catch (err) {
        return {
          ok: false,
          reason: 'failed',
          error: err instanceof Error ? err.message : String(err),
          steps: [],
          skipped: 0,
        };
      } finally {
        controllers.delete(graphId);
      }
    },
  };
}

/** 与图契约里的上限保持一处（供界面提示用） */
export const canvasRunnerLimits = { maxSteps: CANVAS_MAX_RUN_STEPS, maxConfigBytes: CANVAS_MAX_CONFIG_BYTES };
