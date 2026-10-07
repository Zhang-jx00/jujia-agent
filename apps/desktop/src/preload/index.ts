import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  IPC,
  appInfoSchema,
  chatSendResultSchema,
  compactApplySchema,
  compactApplyResultSchema,
  compactPreviewResultSchema,
  compactStatusSchema,
  chatHistoryPageSchema,
  chatHistoryQuerySchema,
  chatSessionMetaSchema,
  configSnapshotSchema,
  connectionViewSchema,
  mcpApprovalChoiceSchema,
  mcpApproveResultSchema,
  mcpConnectResultSchema,
  mcpServerInputSchema,
  hooksSaveResultSchema,
  hooksStateSchema,
  pluginsStateSchema,
  mcpApprovalPlanSchema,
  mcpServerViewSchema,
  permissionDecisionSchema,
  pendingNotesViewSchema,
  pendingPreviewSchema,
  pendingPreviewResultSchema,
  pendingResolveSchema,
  pendingResolveResultSchema,
  permissionExpiredSchema,
  permissionRequestSchema,
  permissionRuleInputSchema,
  permissionRuleViewSchema,
  streamEventSchema,
  testResultSchema,
  toolRunResultSchema,
  workspaceInfoSchema,
  type AppConfig,
  type AppInfo,
  type ChatHistoryPage,
  type ChatHistoryQuery,
  type ChatSessionMeta,
  type ChatSendResult,
  type CompactApplyResult,
  type CompactPreviewResult,
  type CompactStatusView,
  type PendingNotesView,
  type PendingPreviewResult,
  type PendingResolveResult,
  type ConfigSnapshot,
  type ConnectionInput,
  type ConnectionView,
  type McpApprovalChoice,
  type McpApprovalPlan,
  type McpApproveResult,
  type McpConnectResult,
  type McpServerInput,
  type McpServerView,
  type PermissionDecisionPayload,
  type PermissionExpiredPayload,
  type PermissionRequestPayload,
  type HooksSaveResult,
  type HooksState,
  type PluginsState,
  type PermissionRuleInput,
  type PermissionRuleView,
  type StreamEvent,
  type TestResult,
  type ToolRunResult,
  type WorkspaceInfo,
  terminalEventSchema,
  terminalInputSchema,
  terminalKillSchema,
  terminalResizeSchema,
  terminalStartResultSchema,
  terminalStartSchema,
  type TerminalEventPayload,
  type TerminalStartPayload,
  type TerminalStartResultPayload,
  browserBoundsSchema,
  browserStateSchema,
  browserTextResultSchema,
  browserExeClearSchema,
  browserExePickResultSchema,
  browserExeStateSchema,
  browserOpenWithResultSchema,
  browserOpenWithSchema,
  gitActionResultSchema,
  gitCommitSchema,
  gitDiffResultSchema,
  gitLogResultSchema,
  pdfOpenQuerySchema,
  pdfOpenResultSchema,
  canvasEventSchema,
  canvasListResultSchema,
  canvasLoadQuerySchema,
  canvasLoadResultSchema,
  canvasRunResultSchema,
  canvasRunSchema,
  canvasSaveResultSchema,
  canvasSaveSchema,
  gitPathsSchema,
  gitStatusResultSchema,
  type BrowserBoundsPayload,
  type BrowserExePickResult,
  type BrowserExeState,
  type BrowserOpenTarget,
  type BrowserOpenWithResult,
  type BrowserState,
  type BrowserTextResult,
  type GitActionResultView,
  type GitDiffResult,
  type GitLogResult,
  type CanvasEventPayload,
  type CanvasListResult,
  type CanvasLoadResult,
  type CanvasRunResult,
  type CanvasSaveResult,
  type PdfOpenResult,
  type GitStatusResult,
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

  /** 分页读历史（6a）：返回这一页 + 总数 + 还剩多少条可往前翻 */
  async chatHistory(query: ChatHistoryQuery): Promise<ChatHistoryPage> {
    return chatHistoryPageSchema.parse(
      await ipcRenderer.invoke(IPC.CHAT_HISTORY, chatHistoryQuerySchema.parse(query)),
    );
  },

  /** 磁盘上有哪些会话（重启后能续哪个，就靠它） */
  async chatList(): Promise<ChatSessionMeta[]> {
    return z.array(chatSessionMetaSchema).parse(await ipcRenderer.invoke(IPC.CHAT_LIST));
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

  /**
   * 订阅"某个审批请求已在主进程侧结束"的通知（超时 / 窗口销毁）。
   * 渲染层按 id 关掉对应那一张弹窗 —— 见 `IPC.PERMISSION_EXPIRED` 的注释。
   */
  onPermissionExpired(listener: (payload: PermissionExpiredPayload) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => {
      const parsed = permissionExpiredSchema.safeParse(payload);
      if (!parsed.success) {
        console.error('[preload] 丢弃不符合契约的审批结束通知:', parsed.error.message);
        return;
      }
      listener(parsed.data);
    };
    ipcRenderer.on(IPC.PERMISSION_EXPIRED, handler);
    return () => {
      ipcRenderer.removeListener(IPC.PERMISSION_EXPIRED, handler);
    };
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

  /* ---------------------------- 内置终端（W9b） ---------------------------- */

  /** 新建终端会话（主进程会先弹权限审批） */
  async terminalStart(
    payload: TerminalStartPayload,
  ): Promise<TerminalStartResultPayload> {
    const parsed = terminalStartSchema.parse(payload);
    return terminalStartResultSchema.parse(await ipcRenderer.invoke(IPC.TERMINAL_START, parsed));
  },

  async terminalInput(sessionId: string, data: string): Promise<boolean> {
    const parsed = terminalInputSchema.parse({ sessionId, data });
    return z.boolean().parse(await ipcRenderer.invoke(IPC.TERMINAL_INPUT, parsed));
  },

  async terminalResize(sessionId: string, cols: number, rows: number): Promise<boolean> {
    const parsed = terminalResizeSchema.parse({ sessionId, cols, rows });
    return z.boolean().parse(await ipcRenderer.invoke(IPC.TERMINAL_RESIZE, parsed));
  },

  async terminalKill(sessionId: string): Promise<boolean> {
    const parsed = terminalKillSchema.parse({ sessionId });
    return z.boolean().parse(await ipcRenderer.invoke(IPC.TERMINAL_KILL, parsed));
  },

  /** 订阅终端事件；返回取消订阅函数 */
  onTerminalStream(handler: (event: TerminalEventPayload) => void): () => void {
    const listener = (_e: unknown, payload: unknown): void => {
      const parsed = terminalEventSchema.safeParse(payload);
      if (parsed.success) handler(parsed.data);
    };
    ipcRenderer.on(IPC.TERMINAL_STREAM, listener);
    return () => ipcRenderer.removeListener(IPC.TERMINAL_STREAM, listener);
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

  /* ------------------------------ MCP（W10e） ------------------------------ */

  async mcpServerList(): Promise<McpServerView[]> {
    return z.array(mcpServerViewSchema).parse(await ipcRenderer.invoke(IPC.MCP_SERVER_LIST));
  },

  async mcpServerSave(input: McpServerInput): Promise<McpServerView> {
    const parsed = mcpServerInputSchema.parse(input);
    return mcpServerViewSchema.parse(await ipcRenderer.invoke(IPC.MCP_SERVER_SAVE, parsed));
  },

  async mcpServerDelete(id: string): Promise<boolean> {
    return z.boolean().parse(await ipcRenderer.invoke(IPC.MCP_SERVER_DELETE, id));
  },

  /** 发起连接：主进程会起子进程、握手、列工具，然后返回**待你批准的计划** */
  async mcpConnect(id: string): Promise<McpConnectResult> {
    return mcpConnectResultSchema.parse(await ipcRenderer.invoke(IPC.MCP_CONNECT, id));
  },

  /** 回填批准选择（逐工具） */
  /**
   * 取回"待你批准"的接入计划（外部审查 T9）：切页签、重载页面之后还能接着批，
   * 不必重新连一次 —— 重新连等于真的再起一个第三方进程。
   */
  async mcpPendingPlan(): Promise<McpApprovalPlan | null> {
    const raw: unknown = await ipcRenderer.invoke(IPC.MCP_PENDING_PLAN);
    if (raw === null) return null;
    return mcpApprovalPlanSchema.parse(raw);
  },

  async mcpApprove(id: string, choice: McpApprovalChoice): Promise<McpApproveResult> {
    const parsed = mcpApprovalChoiceSchema.parse(choice);
    return mcpApproveResultSchema.parse(
      await ipcRenderer.invoke(IPC.MCP_APPROVE, { id, choice: parsed }),
    );
  },

  async mcpDisconnect(id: string): Promise<boolean> {
    return z.boolean().parse(await ipcRenderer.invoke(IPC.MCP_DISCONNECT, id));
  },

  /** 订阅 MCP 状态变化（进程退出、握手失败等）；返回取消订阅函数 */
  onMcpStateChanged(listener: (views: McpServerView[]) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => {
      const parsed = z.array(mcpServerViewSchema).safeParse(payload);
      if (!parsed.success) {
        console.error('[preload] 丢弃不符合契约的 MCP 状态:', parsed.error.message);
        return;
      }
      listener(parsed.data);
    };
    ipcRenderer.on(IPC.MCP_STATE_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC.MCP_STATE_CHANGED, handler);
    };
  },

  /* --------------------------- 权限规则表（W5c） --------------------------- */

  /* --------------------------- 生命周期钩子（W5d） --------------------------- */

  async hooksGet(): Promise<HooksState> {
    return hooksStateSchema.parse(await ipcRenderer.invoke(IPC.HOOKS_GET));
  },

  /** 保存钩子配置：校验失败时**不落盘**，错误逐条返回 */
  async hooksSet(input: Record<string, unknown>): Promise<HooksSaveResult> {
    return hooksSaveResultSchema.parse(await ipcRenderer.invoke(IPC.HOOKS_SET, input));
  },

  /** 插件加载结果（只读；含贡献物与诊断） */
  async pluginsGet(): Promise<PluginsState> {
    return pluginsStateSchema.parse(await ipcRenderer.invoke(IPC.PLUGINS_GET));
  },

  async permissionRulesList(): Promise<PermissionRuleView[]> {
    return z.array(permissionRuleViewSchema).parse(await ipcRenderer.invoke(IPC.PERMISSION_RULES_LIST));
  },

  async permissionRulesAdd(input: PermissionRuleInput): Promise<PermissionRuleView> {
    const parsed = permissionRuleInputSchema.parse(input);
    return permissionRuleViewSchema.parse(await ipcRenderer.invoke(IPC.PERMISSION_RULES_ADD, parsed));
  },

  async permissionRulesRemove(id: string): Promise<boolean> {
    return z.boolean().parse(await ipcRenderer.invoke(IPC.PERMISSION_RULES_REMOVE, id));
  },

  async permissionRulesToggle(id: string, enabled: boolean): Promise<PermissionRuleView> {
    return permissionRuleViewSchema.parse(
      await ipcRenderer.invoke(IPC.PERMISSION_RULES_TOGGLE, { id, enabled }),
    );
  },

  /* ---------------------------- 内置浏览器（M10） ---------------------------- */

  /**
   * 用户主动打开/跳转。**只有一个入口**：交给谁打开由 `target` 决定，
   * 授权与否由主进程判档（内置不问；外部两档每次硬 ask）—— 渲染层没有"绕过选档"的另一条通道。
   */
  async browserOpenWith(url: string, target: BrowserOpenTarget): Promise<BrowserOpenWithResult> {
    return browserOpenWithResultSchema.parse(
      await ipcRenderer.invoke(IPC.BROWSER_OPEN_WITH, browserOpenWithSchema.parse({ url, target })),
    );
  },

  async browserBack(): Promise<BrowserState> {
    return browserStateSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_BACK));
  },

  async browserForward(): Promise<BrowserState> {
    return browserStateSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_FORWARD));
  },

  async browserReload(): Promise<BrowserState> {
    return browserStateSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_RELOAD));
  },

  async browserClose(): Promise<BrowserState> {
    return browserStateSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_CLOSE));
  },

  /**
   * 上报占位区位置。
   * 为什么必须经渲染层报：`WebContentsView` 是浮在渲染层**之上**的原生视图，
   * CSS 管不到它，只能由主进程按坐标摆放 —— 而只有渲染层知道自己的那块地方在哪、多大。
   */
  async browserSetBounds(bounds: BrowserBoundsPayload): Promise<boolean> {
    return z.boolean().parse(
      await ipcRenderer.invoke(IPC.BROWSER_SET_BOUNDS, browserBoundsSchema.parse(bounds)),
    );
  },

  /** 读取正文（交给模型用）；主进程只取可见文本且有上限 */
  async browserGetText(): Promise<BrowserTextResult> {
    return browserTextResultSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_GET_TEXT));
  },

  async browserState(): Promise<BrowserState> {
    return browserStateSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_STATE));
  },

  /* ---------------- 自选程序（M10 收尾：打开方式的第三档） ---------------- */

  /** 用**主进程的原生对话框**选自选程序；界面没有"直接填路径"这条路 */
  async browserExePick(): Promise<BrowserExePickResult> {
    return browserExePickResultSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_EXE_PICK));
  },

  async browserExeGet(): Promise<BrowserExeState> {
    return browserExeStateSchema.parse(await ipcRenderer.invoke(IPC.BROWSER_EXE_GET));
  },

  async browserExeClear(): Promise<BrowserExePickResult> {
    return browserExePickResultSchema.parse(
      await ipcRenderer.invoke(IPC.BROWSER_EXE_SET, browserExeClearSchema.parse({ path: null })),
    );
  },

  /** 订阅浏览器状态变化；返回取消订阅函数 */
  onBrowserState(handler: (state: BrowserState) => void): () => void {
    const listener = (_e: unknown, payload: unknown): void => {
      const parsed = browserStateSchema.safeParse(payload);
      if (parsed.success) handler(parsed.data);
      // 解析失败**不静默**：契约不匹配要能被看见（与流式事件同一纪律）
      else console.error('[preload] 丢弃不符合契约的浏览器状态事件:', parsed.error.message);
    };
    ipcRenderer.on(IPC.BROWSER_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.BROWSER_STATE_CHANGED, listener);
  },

  /* ---------------------------- git（M8 接线） ---------------------------- */

  /**
   * 三条只读 + 三条写。写操作的**审批不在这里**：主进程经同一条权限桥弹窗，
   * 渲染层只负责把"做没做、为什么没做"显示出来。
   * 出参照旧再校验一次 —— 契约漂移要在这里暴露，而不是让界面拿到半截数据。
   */
  async gitStatus(): Promise<GitStatusResult> {
    return gitStatusResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_STATUS));
  },

  /**
   * git diff：默认 `summary`（关键行摘录，既有调用点不变）；
   * `{mode:'patch', path}` 拿逐行原文给 IDE 的 diff 视图用。
   */
  async gitDiff(
    staged = false,
    options: { mode?: 'summary' | 'patch'; path?: string } = {},
  ): Promise<GitDiffResult> {
    return gitDiffResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_DIFF, { staged, ...options }));
  },

  async gitLog(count = 20): Promise<GitLogResult> {
    return gitLogResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_LOG, { count }));
  },

  /** 打开一份 PDF（M19）：只读、过路径守卫、**只回渲染层**（不进模型上下文） */
  async pdfOpen(path: string): Promise<PdfOpenResult> {
    const query = pdfOpenQuerySchema.parse({ path });
    return pdfOpenResultSchema.parse(await ipcRenderer.invoke(IPC.PDF_OPEN, query));
  },

  /* ------------------------------ 无限画布（M9） ------------------------------ */

  async canvasList(): Promise<CanvasListResult> {
    return canvasListResultSchema.parse(await ipcRenderer.invoke(IPC.CANVAS_LIST));
  },

  async canvasLoad(id: string): Promise<CanvasLoadResult> {
    const query = canvasLoadQuerySchema.parse({ id });
    return canvasLoadResultSchema.parse(await ipcRenderer.invoke(IPC.CANVAS_LOAD, query));
  },

  async canvasSave(id: string, graph: unknown): Promise<CanvasSaveResult> {
    const payload = canvasSaveSchema.parse({ id, graph });
    return canvasSaveResultSchema.parse(await ipcRenderer.invoke(IPC.CANVAS_SAVE, payload));
  },

  async canvasRun(id: string, fromNodeId?: string): Promise<CanvasRunResult> {
    // B2 局部重跑：`fromNodeId` 缺省 = 整图；带上 = 该节点 + 全部下游
    const payload = canvasRunSchema.parse(fromNodeId === undefined ? { id } : { id, fromNodeId });
    return canvasRunResultSchema.parse(await ipcRenderer.invoke(IPC.CANVAS_RUN, payload));
  },

  async canvasStop(id: string): Promise<boolean> {
    const payload = canvasRunSchema.parse({ id });
    const raw: unknown = await ipcRenderer.invoke(IPC.CANVAS_STOP, payload);
    return raw === true;
  },

  /**
   * 订阅节点事件（main → renderer 推送）。
   * 回调拿到的是**带归属**的事件（graphId + nodeId）——界面据此判断"这是不是我正在看的那张图的第几步"。
   */
  onCanvasEvent(listener: (event: CanvasEventPayload) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => {
      const parsed = canvasEventSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
      else console.warn('[canvas] 丢弃形状不合法的事件：', parsed.error.message);
    };
    ipcRenderer.on(IPC.CANVAS_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.CANVAS_EVENT, handler);
  },

  async gitStage(paths: string[]): Promise<GitActionResultView> {
    const parsed = gitPathsSchema.parse({ paths });
    return gitActionResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_STAGE, parsed));
  },

  async gitUnstage(paths: string[]): Promise<GitActionResultView> {
    const parsed = gitPathsSchema.parse({ paths });
    return gitActionResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_UNSTAGE, parsed));
  },

  /** 提交：**每次都会弹确认**（硬 ask），界面必须把这条语义显示给用户而不是悄悄失败 */
  async gitCommit(message: string): Promise<GitActionResultView> {
    const parsed = gitCommitSchema.parse({ message });
    return gitActionResultSchema.parse(await ipcRenderer.invoke(IPC.GIT_COMMIT, parsed));
  },

  /* -------------------- 6b：会话压缩与「结束记要点」 -------------------- *
   * 产出侧一律过一遍 schema：这条边跨进程，主进程改了形状而渲染层没跟上时，
   * 宁可在这里炸，也不要让界面拿 undefined 当"没有内容"。
   */

  /** 问一句"到阈值了吗"（只提示，不压） */
  async chatCompactStatus(sessionId: string): Promise<CompactStatusView | null> {
    const raw = await ipcRenderer.invoke(IPC.CHAT_COMPACT_STATUS, sessionId);
    if (raw === null) return null;
    return compactStatusSchema.parse(raw);
  },

  /** 生成摘要预览：**这一步不落盘** */
  async chatCompactPreview(sessionId: string): Promise<CompactPreviewResult> {
    return compactPreviewResultSchema.parse(await ipcRenderer.invoke(IPC.CHAT_COMPACT_PREVIEW, sessionId));
  },

  /** 用户点「就按这版存」之后才调它 */
  async chatCompactApply(sessionId: string, summary: string): Promise<CompactApplyResult> {
    const parsed = compactApplySchema.parse({ sessionId, summary });
    return compactApplyResultSchema.parse(await ipcRenderer.invoke(IPC.CHAT_COMPACT_APPLY, parsed));
  },

  /** 显式结束会话：只记一笔待办 */
  async chatEnd(sessionId: string): Promise<PendingResolveResult> {
    return pendingResolveResultSchema.parse(await ipcRenderer.invoke(IPC.CHAT_END, sessionId));
  },

  async chatPendingList(): Promise<PendingNotesView> {
    return pendingNotesViewSchema.parse(await ipcRenderer.invoke(IPC.CHAT_PENDING_LIST));
  },

  /** 只要会话 id：用哪条连接生成要点，由主进程按会话记录决定（批复⑤） */
  async chatPendingPreview(sessionId: string): Promise<PendingPreviewResult> {
    const parsed = pendingPreviewSchema.parse({ sessionId });
    return pendingPreviewResultSchema.parse(await ipcRenderer.invoke(IPC.CHAT_PENDING_PREVIEW, parsed));
  },

  /**
   * 唯一能进长期记忆的那一下。
   * 故意**不收工作区路径**：写哪儿由主进程按当前工作区决定，渲染层没有发言权。
   */
  async chatPendingResolve(
    sessionId: string,
    action: 'remember' | 'skip' | 'never',
    text: string,
  ): Promise<PendingResolveResult> {
    const parsed = pendingResolveSchema.parse({ sessionId, action, text, workspaceRoot: null });
    return pendingResolveResultSchema.parse(await ipcRenderer.invoke(IPC.CHAT_PENDING_RESOLVE, parsed));
  },
};

export type JujiaApi = typeof api;

contextBridge.exposeInMainWorld('jujia', api);
