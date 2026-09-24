import {
  IPC,
  chatSendResultSchema,
  connectionInputSchema,
  testResultSchema,
  type ChatSendResult,
  type ConnectionView,
  type TestResult,
} from '@jujia/shared-ipc';
import { listModels } from '@jujia/agent-core';
import {
  createConnection,
  deleteConnection,
  listConnectionViews,
  resolveConnection,
  updateConnection,
} from '../connections-store';
import { getHistory, sendMessage, stopMessage } from '../chat-service';
import { getWorkspaceInfo } from '../workspace';
import { summarizeCatalog } from '@jujia/agent-core';
import type { IpcContext } from './context';

/**
 * 连接管理与对话。
 *
 * 对话这一路是**权限参数的汇聚点**：模式、用户规则、高危清单、钩子运行器、
 * 共享注册表全部要在这里传给 `sendMessage` —— 少传一项，界面看起来一切正常但引擎在裸奔
 * （W10g 之前就是死代码状态）。所以这些参数**逐个显式列出来**，不用展开对象蒙混。
 */
export function registerChatIpc(ctx: IpcContext): void {
  const { handle, deps, fetchImpl, mcpDebug, plugins, skills, registry, hookRunner, loadPolicy } = ctx;

  /* ------------------------------ 连接管理 ------------------------------ */

  handle(IPC.CONNECTION_LIST, async (): Promise<ConnectionView[]> => {
    return listConnectionViews();
  });

  handle(IPC.CONNECTION_CREATE, async (_e, input: unknown): Promise<ConnectionView> => {
    return createConnection(connectionInputSchema.parse(input));
  });

  handle(IPC.CONNECTION_UPDATE, async (_e, payload: unknown): Promise<ConnectionView> => {
    const { id, patch } = (payload ?? {}) as { id?: unknown; patch?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    return updateConnection(id, patch);
  });

  handle(IPC.CONNECTION_DELETE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少连接 id');
    return deleteConnection(id);
  });

  handle(IPC.CONNECTION_TEST, async (_e, id: unknown): Promise<TestResult> => {
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

  /* -------------------------------- 对话 -------------------------------- */

  handle(IPC.CHAT_SEND, async (_e, payload: unknown): Promise<ChatSendResult> => {
    const { connectionId, text, sessionId } = (payload ?? {}) as {
      connectionId?: unknown;
      text?: unknown;
      sessionId?: unknown;
    };
    if (typeof connectionId !== 'string' || connectionId === '') throw new Error('请先选择一个连接');
    if (typeof text !== 'string' || text.trim() === '') throw new Error('消息不能为空');

    // 工作区决定了工具是否可用；未选择时仍可对话，但工具会被路径校验拒绝
    const ws = await getWorkspaceInfo();
    const policy = await loadPolicy();
    await plugins.refresh(ws.valid ? ws.root : null);
    const skillCatalog = await skills.refresh(ws.valid ? ws.root : null);
    mcpDebug('[plugins] ' + plugins.summary());
    mcpDebug('[skills] ' + summarizeCatalog(skillCatalog));
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
        // 同一个注册表：内置工具 + 已批准的 MCP 工具都在这里，模型才看得到它们
        registry,
        mode: policy.mode,
        rules: policy.rules,
        alwaysAsk: policy.alwaysAsk,
        hooks: hookRunner,
        skillCatalogText: skills.catalogText(),
      },
    );
    return chatSendResultSchema.parse({ ...result, accepted: true });
  });

  handle(IPC.CHAT_STOP, async (_e, sessionId: unknown): Promise<boolean> => {
    if (typeof sessionId !== 'string' || sessionId === '') return false;
    return stopMessage(sessionId);
  });

  handle(IPC.CHAT_HISTORY, async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId === '') return [];
    return getHistory(sessionId);
  });
}
