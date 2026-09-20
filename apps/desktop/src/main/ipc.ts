import { ipcMain, app } from 'electron';
import {
  IPC,
  appConfigSchema,
  appInfoSchema,
  chatSendResultSchema,
  configSnapshotSchema,
  connectionInputSchema,
  permissionDecisionSchema,
  testResultSchema,
  toolRunResultSchema,
  workspaceInfoSchema,
  type AppConfig,
  type AppInfo,
  type ChatSendResult,
  type ConfigSnapshot,
  type ConnectionView,
  type StreamEvent,
  type TestResult,
  type ToolRunResult,
} from '@jujia/shared-ipc';
import { createDefaultRegistry, runTool, type ToolRegistry } from '@jujia/agent-core';
import { listModels } from '@jujia/agent-core';
import { clearWorkspace, getWorkspaceInfo, pickWorkspace } from './workspace';
import type { PermissionBridge } from './permission-bridge';
import { getDataRoot } from './paths';
import { readConfigSnapshot, writeConfig } from './config-store';
import {
  createConnection,
  deleteConnection,
  listConnectionViews,
  resolveConnection,
  updateConnection,
} from './connections-store';
import { getHistory, sendMessage, stopMessage } from './chat-service';

export interface IpcDeps {
  /** 把流式事件推给渲染层（由 main/index.ts 注入，便于测试与窗口重建） */
  emitStream: (event: StreamEvent) => void;
  /** 权限审批桥（W3）：写/执行类工具经它询问用户 */
  permission: PermissionBridge;
  /** 取当前主窗口（目录选择对话框需要作为父窗口） */
  getWindow?: () => Electron.BrowserWindow | undefined;
  /** 工具注册表（默认内置文件工具；W4+ 会注入更多） */
  registry?: ToolRegistry;
  /** 测试用：覆盖 fetch */
  fetcher?: typeof fetch;
}

/**
 * 注册 main 侧 IPC handler。
 * 约定：入参与出参都必须过 zod 校验，避免契约悄悄漂移。
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const fetchImpl = deps.fetcher ?? fetch;

  ipcMain.handle(IPC.APP_INFO, (): AppInfo => {
    const payload: AppInfo = {
      name: '俱佳Agent',
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      platform: process.platform,
      security: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
      dataRoot: getDataRoot(),
    };
    return appInfoSchema.parse(payload);
  });

  ipcMain.handle(IPC.CONFIG_GET, async (): Promise<ConfigSnapshot> => {
    return configSnapshotSchema.parse(await readConfigSnapshot());
  });

  ipcMain.handle(IPC.CONFIG_SET, async (_e, patch: unknown): Promise<ConfigSnapshot> => {
    // 只接受已知字段，防止渲染层塞任意键污染配置；
    // 显式剔除 undefined 以配合 exactOptionalPropertyTypes
    const parsed = appConfigSchema.partial().parse(patch);
    const clean: Partial<AppConfig> = {};
    if (parsed.theme !== undefined) clean.theme = parsed.theme;
    if (parsed.workspace !== undefined) clean.workspace = parsed.workspace;
    return configSnapshotSchema.parse(await writeConfig(clean));
  });

  /* ---------------------------- 连接管理 ---------------------------- */

  ipcMain.handle(IPC.CONNECTION_LIST, async (): Promise<ConnectionView[]> => {
    return listConnectionViews();
  });

  ipcMain.handle(IPC.CONNECTION_CREATE, async (_e, input: unknown): Promise<ConnectionView> => {
    return createConnection(connectionInputSchema.parse(input));
  });

  ipcMain.handle(IPC.CONNECTION_UPDATE, async (_e, payload: unknown): Promise<ConnectionView> => {
    const { id, patch } = (payload ?? {}) as { id?: unknown; patch?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    return updateConnection(id, patch);
  });

  ipcMain.handle(IPC.CONNECTION_DELETE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    return deleteConnection(id);
  });

  ipcMain.handle(IPC.CONNECTION_TEST, async (_e, id: unknown): Promise<TestResult> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    const started = Date.now();
    try {
      const { record, apiKey } = await resolveConnection(id);
      const models = await listModels(
        { baseUrl: record.baseUrl, apiKey, signal: AbortSignal.timeout(20_000) },
        { fetcher: fetchImpl },
      );
      return testResultSchema.parse({
        ok: true,
        message: `连通成功，可用模型 ${models.length} 个`,
        models,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      return testResultSchema.parse({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        models: [],
        latencyMs: Date.now() - started,
      });
    }
  });

  /* ------------------------------ 对话 ------------------------------ */

  ipcMain.handle(IPC.CHAT_SEND, async (_e, payload: unknown): Promise<ChatSendResult> => {
    const { connectionId, text, sessionId } = (payload ?? {}) as {
      connectionId?: unknown;
      text?: unknown;
      sessionId?: unknown;
    };
    if (typeof connectionId !== 'string' || connectionId === '') throw new Error('请先选择一个连接');
    if (typeof text !== 'string' || text.trim() === '') throw new Error('消息不能为空');

    // 工作区决定了工具是否可用；未选择时仍可对话，但工具会被路径校验拒绝
    const ws = await getWorkspaceInfo();
    const result = sendMessage(
      {
        connectionId,
        text,
        ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
      },
      deps.emitStream,
      {
        fetcher: fetchImpl,
        permission: deps.permission.resolve,
        workspaceRoot: ws.valid ? ws.root : null,
        ...(deps.registry ? { registry: deps.registry } : {}),
      },
    );
    return chatSendResultSchema.parse({ ...result, accepted: true });
  });

  ipcMain.handle(IPC.CHAT_STOP, async (_e, sessionId: unknown): Promise<boolean> => {
    if (typeof sessionId !== 'string' || sessionId === '') return false;
    return stopMessage(sessionId);
  });

  ipcMain.handle(IPC.CHAT_HISTORY, async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId === '') return [];
    return getHistory(sessionId);
  });

  /* ---------------------- W3：工作区与工具执行 ---------------------- */

  ipcMain.handle(IPC.WORKSPACE_GET, async () => workspaceInfoSchema.parse(await getWorkspaceInfo()));

  ipcMain.handle(IPC.WORKSPACE_PICK, async () =>
    workspaceInfoSchema.parse(await pickWorkspace(deps.getWindow?.())),
  );

  ipcMain.handle(IPC.WORKSPACE_CLEAR, async () =>
    workspaceInfoSchema.parse(await clearWorkspace()),
  );

  ipcMain.handle(IPC.PERMISSION_RESOLVE, async (_e, payload: unknown): Promise<boolean> => {
    const { id, decision, updatedArgs } = (payload ?? {}) as {
      id?: unknown;
      decision?: unknown;
      updatedArgs?: unknown;
    };
    if (typeof id !== 'string' || id === '') return false;
    const parsed = permissionDecisionSchema.safeParse(decision);
    if (!parsed.success) return false;
    return deps.permission.settle(id, parsed.data, updatedArgs);
  });

  ipcMain.handle(IPC.TOOL_RUN, async (_e, payload: unknown): Promise<ToolRunResult> => {
    const { toolName, args } = (payload ?? {}) as { toolName?: unknown; args?: unknown };
    if (typeof toolName !== 'string' || toolName === '') {
      throw new Error('缺少工具名');
    }

    const info = await getWorkspaceInfo();
    if (!info.root || !info.valid) {
      return toolRunResultSchema.parse({
        ok: false,
        toolName,
        content: `无法执行：${info.message}。请先在「概览」页选择工作区。`,
        durationMs: 0,
        asked: false,
        decision: null,
        paths: [],
      });
    }

    const registry = deps.registry ?? createDefaultRegistry();
    const tool = registry.get(toolName);
    const res = await runTool(tool, args ?? {}, { workspaceRoot: info.root }, deps.permission.resolve);

    return toolRunResultSchema.parse({
      ok: res.outcome.ok,
      toolName,
      content: res.outcome.content,
      durationMs: res.durationMs,
      asked: res.asked,
      decision: res.decision ?? null,
      paths: res.outcome.evidence?.paths ?? [],
    });
  });
}
