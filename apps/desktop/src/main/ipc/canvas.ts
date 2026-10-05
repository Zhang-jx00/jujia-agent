import {
  IPC,
  canvasEventSchema,
  canvasGraphSchema,
  canvasRunResultSchema,
  validateGraph,
  type CanvasGraph,
} from '@jujia/shared-ipc';
import { resolveConnection } from '../connections-store';
import { getDataRoot } from '../paths';
import { getWorkspaceInfo } from '../workspace';
import { createCanvasStore, defaultCanvasRoot, type CanvasStore } from '../canvas-store';
import { createCanvasRunner, type CanvasRunner } from '../canvas-runner';
import type { IpcContext } from './context';

/**
 * 无限画布（M9a）的通道：**图的读写**（三条）+ **跑的起停**（两条）+ 事件推送（一条）。
 *
 * 四件值得写下来的事：
 * 1. **保存前过 `validateGraph`**：成环/重复边/缺配置/超限/疑似密钥字段都在这里拦 ——
 *    界面也会用同一套规则做即时反馈，但**把关必须在主进程**（界面可以被绕过）；
 * 2. **运行前再校验一次**：图可能是在磁盘上被手改过的，不能信"保存时是干净的"；
 * 3. **事件带归属**（graphId + nodeId）后才推给渲染层（批复追加要求 a）；
 * 4. **图的 store 与 runner 都是懒建**：模块加载期不能碰 electron 路径（老规矩）。
 */

let storeRef: CanvasStore | null = null;
function store(): CanvasStore {
  if (storeRef === null) storeRef = createCanvasStore(defaultCanvasRoot(getDataRoot()));
  return storeRef;
}

let runnerRef: CanvasRunner | null = null;

export function registerCanvasIpc(ctx: IpcContext): void {
  const { handle, deps, registry, hookRunner, loadPolicy } = ctx;

  const runner = (): CanvasRunner => {
    if (runnerRef === null) {
      runnerRef = createCanvasRunner({
        getWorkspaceRoot: async () => {
          const info = await getWorkspaceInfo();
          return info.root && info.valid ? info.root : null;
        },
        loadPolicy,
        permission: deps.permission.resolve,
        registry,
        resolveConnection: (id) => resolveConnection(id),
        hooks: hookRunner,
        emit: (event) => {
          // 出口只在这一处：**先过契约**（缺 graphId/nodeId 的事件不许溜到界面）
          const parsed = canvasEventSchema.safeParse(event);
          if (!parsed.success) {
            console.warn('[canvas] 事件形状不合法，已丢弃（这是内部缺陷，不该发生）：', parsed.error.message);
            return;
          }
          deps.getWindow?.()?.webContents.send(IPC.CANVAS_EVENT, parsed.data);
        },
        ...(deps.fetcher === undefined ? {} : { fetcher: deps.fetcher }),
      });
    }
    return runnerRef;
  };

  handle(IPC.CANVAS_LIST, async () => ({ items: await store().list() }));

  handle(IPC.CANVAS_LOAD, async (_e, payload: unknown) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id === '') return { ok: false, graph: null, error: '缺少图标识' };
    const loaded = await store().load(id);
    return loaded.ok
      ? { ok: true, graph: loaded.graph, error: '' }
      : { ok: false, graph: null, error: loaded.error };
  });

  handle(IPC.CANVAS_SAVE, async (_e, payload: unknown) => {
    const p = payload as { id?: unknown; graph?: unknown } | null;
    const id = p?.id;
    if (typeof id !== 'string' || id === '') {
      return { ok: false, error: '缺少图标识', problems: [] };
    }
    const parsed = canvasGraphForSave(p?.graph);
    if (!parsed.ok) return { ok: false, error: parsed.error, problems: parsed.problems };
    const saved = await store().save(id, parsed.graph);
    return saved.ok ? { ok: true, error: '', problems: [] } : { ok: false, error: saved.error, problems: [] };
  });

  handle(IPC.CANVAS_RUN, async (_e, payload: unknown) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id === '') {
      return canvasRunResultSchema.parse({ ok: false, reason: null, error: '缺少图标识', steps: [] });
    }
    const loaded = await store().load(id);
    if (!loaded.ok) {
      return canvasRunResultSchema.parse({ ok: false, reason: null, error: loaded.error, steps: [] });
    }
    // 磁盘上的图可能被手改过：**跑之前再校验一次**
    const problems = validateGraph(loaded.graph);
    if (problems.length > 0) {
      return canvasRunResultSchema.parse({
        ok: false,
        reason: null,
        error: `这张图有问题，没有开跑：${problems.map((p) => p.message).join('；')}`,
        steps: [],
      });
    }
    const result = await runner().run(id, loaded.graph);
    return canvasRunResultSchema.parse({
      ok: result.ok,
      reason: result.reason,
      error: result.error,
      steps: result.steps.slice(0, 200),
    });
  });

  handle(IPC.CANVAS_STOP, async (_e, payload: unknown) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id === '') return false;
    return runner().stop(id);
  });
}

/**
 * 保存前的两道关：**形状**（schema：缺字段 / 多字段 / 类型不对）与**规则**（validateGraph：
 * 成环 / 重复边 / 缺配置 / 超限 / 疑似密钥字段）。两道都过了才落盘 —— 界面里有同一套规则做即时反馈，
 * 但把关必须在主进程：界面可以被绕过。
 */
function canvasGraphForSave(
  input: unknown,
): { ok: true; graph: CanvasGraph } | { ok: false; error: string; problems: string[] } {
  const shape = canvasGraphSchema.safeParse(input);
  if (!shape.success) {
    return {
      ok: false,
      error: '图的形状不合法（缺字段 / 多字段 / 类型不对）',
      problems: shape.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || '(根)'}：${i.message}`),
    };
  }
  const problems = validateGraph(shape.data);
  if (problems.length > 0) {
    const messages = problems.map((p) => p.message);
    return { ok: false, error: `这张图还有问题，先修好再存：${messages.join('；')}`, problems: messages };
  }
  return { ok: true, graph: shape.data };
}
