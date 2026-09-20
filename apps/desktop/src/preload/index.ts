import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  IPC,
  appInfoSchema,
  chatMessageSchema,
  chatSendResultSchema,
  configSnapshotSchema,
  connectionViewSchema,
  permissionDecisionSchema,
  permissionRequestSchema,
  streamEventSchema,
  testResultSchema,
  toolRunResultSchema,
  workspaceInfoSchema,
  type AppConfig,
  type AppInfo,
  type ChatMessageView,
  type ChatSendResult,
  type ConfigSnapshot,
  type ConnectionInput,
  type ConnectionView,
  type PermissionDecisionPayload,
  type PermissionRequestPayload,
  type StreamEvent,
  type TestResult,
  type ToolRunResult,
  type WorkspaceInfo,
} from '@jujia/shared-ipc';

/**
 * 渲染层唯一可用的能力面。
 * 纪律：只暴露具体方法（一方法一通道），绝不暴露 ipcRenderer 本体；
 * 所有出参再校验一次，契约漂移立刻暴露而不是悄悄传下去。
 * apiKey 只在「新增/更新连接」时由渲染层单向送出，永不回传。
 */
const api = {
  async appInfo(): Promise<AppInfo> {
    return appInfoSchema.parse(await ipcRenderer.invoke(IPC.APP_INFO));
  },

  async configGet(): Promise<ConfigSnapshot> {
    return configSnapshotSchema.parse(await ipcRenderer.invoke(IPC.CONFIG_GET));
  },

  async configSet(patch: Partial<AppConfig>): Promise<ConfigSnapshot> {
    return configSnapshotSchema.parse(await ipcRenderer.invoke(IPC.CONFIG_SET, patch));
  },

  /* ---------------------------- 连接 ---------------------------- */

  async connectionList(): Promise<ConnectionView[]> {
    return z.array(connectionViewSchema).parse(await ipcRenderer.invoke(IPC.CONNECTION_LIST));
  },

  async connectionCreate(input: ConnectionInput): Promise<ConnectionView> {
    return connectionViewSchema.parse(await ipcRenderer.invoke(IPC.CONNECTION_CREATE, input));
  },

  async connectionUpdate(id: string, patch: Partial<ConnectionInput>): Promise<ConnectionView> {
    return connectionViewSchema.parse(
      await ipcRenderer.invoke(IPC.CONNECTION_UPDATE, { id, patch }),
    );
  },

  async connectionDelete(id: string): Promise<boolean> {
    return z.boolean().parse(await ipcRenderer.invoke(IPC.CONNECTION_DELETE, id));
  },

  async connectionTest(id: string): Promise<TestResult> {
    return testResultSchema.parse(await ipcRenderer.invoke(IPC.CONNECTION_TEST, id));
  },

  /* ---------------------------- 对话 ---------------------------- */

  async chatSend(payload: {
    connectionId: string;
    text: string;
    sessionId?: string;
  }): Promise<ChatSendResult> {
    return chatSendResultSchema.parse(await ipcRenderer.invoke(IPC.CHAT_SEND, payload));
  },

  async chatStop(sessionId: string): Promise<boolean> {
    return z.boolean().parse(await ipcRenderer.invoke(IPC.CHAT_STOP, sessionId));
  },

  async chatHistory(sessionId: string): Promise<ChatMessageView[]> {
    return z
      .array(chatMessageSchema)
      .parse(await ipcRenderer.invoke(IPC.CHAT_HISTORY, sessionId));
  },

  /* ---------------------- W3：工作区与工具 ---------------------- */

  async workspaceGet(): Promise<WorkspaceInfo> {
    return workspaceInfoSchema.parse(await ipcRenderer.invoke(IPC.WORKSPACE_GET));
  },

  /** 弹出系统目录选择框（路径只能由用户选择产生，渲染层无法直接指定） */
  async workspacePick(): Promise<WorkspaceInfo> {
    return workspaceInfoSchema.parse(await ipcRenderer.invoke(IPC.WORKSPACE_PICK));
  },

  async workspaceClear(): Promise<WorkspaceInfo> {
    return workspaceInfoSchema.parse(await ipcRenderer.invoke(IPC.WORKSPACE_CLEAR));
  },

  async toolRun(toolName: string, args: Record<string, unknown>): Promise<ToolRunResult> {
    return toolRunResultSchema.parse(await ipcRenderer.invoke(IPC.TOOL_RUN, { toolName, args }));
  },

  /** 订阅权限审批请求；返回取消订阅函数 */
  onPermissionRequest(listener: (req: PermissionRequestPayload) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => {
      const parsed = permissionRequestSchema.safeParse(payload);
      if (!parsed.success) {
        console.error('[preload] 丢弃不符合契约的权限请求:', parsed.error.message);
        return;
      }
      listener(parsed.data);
    };
    ipcRenderer.on(IPC.PERMISSION_REQUEST, handler);
    return () => {
      ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler);
    };
  },

  async permissionResolve(
    id: string,
    decision: PermissionDecisionPayload,
    updatedArgs?: unknown,
  ): Promise<boolean> {
    const parsed = permissionDecisionSchema.parse(decision);
    return z.boolean().parse(
      await ipcRenderer.invoke(
        IPC.PERMISSION_RESOLVE,
        updatedArgs === undefined ? { id, decision: parsed } : { id, decision: parsed, updatedArgs },
      ),
    );
  },

  /** 首帧回报（M18）：渲染层挂载完成后调用一次 */
  async reportFirstPaint(): Promise<boolean> {
    return z.boolean().parse(await ipcRenderer.invoke(IPC.PERF_FIRST_PAINT));
  },

  /** 订阅流式事件；返回取消订阅函数 */
  onStream(listener: (event: StreamEvent) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => {
      const parsed = streamEventSchema.safeParse(payload);
      if (!parsed.success) {
        console.error('[preload] 丢弃不符合契约的流式事件:', parsed.error.message);
        return;
      }
      listener(parsed.data);
    };
    ipcRenderer.on(IPC.CHAT_STREAM, handler);
    return () => {
      ipcRenderer.removeListener(IPC.CHAT_STREAM, handler);
    };
  },
};

export type JujiaApi = typeof api;

contextBridge.exposeInMainWorld('jujia', api);
