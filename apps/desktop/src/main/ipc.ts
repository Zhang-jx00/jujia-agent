import { join } from 'node:path';
import { ipcMain, app, type IpcMainInvokeEvent } from 'electron';
import {
  IPC,
  appConfigSchema,
  appInfoSchema,
  chatSendResultSchema,
  configSnapshotSchema,
  connectionInputSchema,
  mcpApproveResultSchema,
  mcpConnectResultSchema,
  mcpServerViewSchema,
  hooksSaveResultSchema,
  hooksStateSchema,
  pluginsStateSchema,
  permissionDecisionSchema,
  permissionRuleInputSchema,
  permissionRuleViewSchema,
  testResultSchema,
  toolRunResultSchema,
  workspaceInfoSchema,
  type AppConfig,
  type AppInfo,
  type ChatSendResult,
  type ConfigSnapshot,
  type ConnectionView,
  type McpConnectResult,
  type HooksState,
  type PermissionMode,
  type StreamEvent,
  type TestResult,
  type ToolRunResult,
  terminalInputSchema,
  terminalKillSchema,
  terminalResizeSchema,
  terminalStartSchema,
} from '@jujia/shared-ipc';
import { z } from 'zod';
import { validateThemePack } from '@jujia/ui-tokens';
import { TerminalService } from './terminal-service';
import { createDefaultRegistry, runTool, type PermissionRule, type ToolRegistry } from '@jujia/agent-core';
import { listModels } from '@jujia/agent-core';
import { McpService } from './mcp/mcp-service';
import { createRealTransport } from './mcp/real-transport';
import { createFilePermissionRulesStore } from './permission-rules-store';
import { createFileHooksService } from './hooks-store';
import { isTrustedSenderUrl } from './security';
import { createSkillsService, userSkillsDir, workspaceSkillsDir } from './skills';
import { createPluginsService } from './plugins';
import { createProcessHookRunner, parseHookConfig, summarizeCatalog, HOOK_EVENTS } from '@jujia/agent-core';
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

  /**
   * **所有通道的统一入口：先校验发送方是应用自己的渲染层**，再交给具体处理函数。
   *
   * 为什么放在统一入口而不是逐个通道里写：33 个通道逐个写，新增一个就会漏一个；
   * 挂在入口上，新通道**默认就是受保护的**（安全默认值）。
   * 拿不到来源 URL 时**拒绝**（fail closed），而不是放行。
   *
   * 说明：渲染层的导航与新窗口早已被安全基线挡住，所以这不是"已经能被利用"的漏洞，
   * 而是纵深防御 —— 将来一旦引入第二个 webContents（内置浏览器、扩展页），
   * 没有这道校验就等于给它开全套 IPC。
   *
   * 位置很关键：必须定义在**任何 handle(...) 调用之前**，
   * 否则 `const` 还在暂时性死区里，注册阶段就抛 ReferenceError（本轮实测踩过）。
   */
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      const senderUrl = event.senderFrame?.url ?? '';
      const trusted = isTrustedSenderUrl(
        senderUrl,
        process.env['ELECTRON_RENDERER_URL'],
        join(__dirname, '../renderer'),
      );
      if (!trusted) {
        throw new Error(
          `[security] 拒绝来自不受信任发送方的 IPC 调用（${channel}）：${
            senderUrl === '' ? '(来源未知)' : senderUrl
          }`,
        );
      }
      return fn(event, ...(args as never[]));
    });
  };

  /**
   * **全进程只用一个工具注册表**。
   *
   * 这是 W10e 修掉的一个接线缺陷：原先 `deps.registry ?? createDefaultRegistry()` 在
   * TOOL_RUN 与对话链路里各写一次，而未注入时会**每次调用都新建一个空注册表** ——
   * 结果是 MCP 批准后的工具注册到 A 表，工具执行时却去 B 表里查（永远查不到）。
   * 表面现象是"批准成功了但模型用不了工具"。
   */
  const registry: ToolRegistry = deps.registry ?? createDefaultRegistry();

  const mcpDebug = (message: string): void => {
    // 默认静默：第三方服务端的日志可能很吵；需要排查时设 JJ_MCP_DEBUG=1
    if (process.env['JJ_MCP_DEBUG'] === '1') console.log(message);
  };
  const mcp = new McpService({
    registry,
    createTransport: (config, hooks) => createRealTransport(config, hooks, mcpDebug),
    onDebug: mcpDebug,
    // 插件声明的 MCP 服务端也进列表与连接流程（审批照旧 —— 插件不能自带权限）
    externalServers: () => plugins.externalServers(),
  });
  mcp.onChanged((views) => {
    deps.getWindow?.()?.webContents.send(IPC.MCP_STATE_CHANGED, views);
  });
  // 应用退出时退掉所有 MCP 子进程，避免留下孤儿进程
  app.on('before-quit', () => {
    mcp.disposeAll();
  });

  /* --------------------------- 生命周期钩子（W5d） --------------------------- */
  // 说明：load() 是异步的，而钩子默认 **关闭** —— 万一在读完之前就有工具调用，
  // 结果只是这次没有钩子参与，主权限门仍然照常生效（fail-open 且有界），不是安全问题。
  const hooksService = createFileHooksService();
  void hooksService.load().catch((err: unknown) => {
    console.error('[hooks] 读取钩子配置失败：', err);
  });
  const hookRunner = createProcessHookRunner({
    getConfig: () => hooksService.getConfig(),
    onDebug: mcpDebug,
  });
  const hooksState = async (): Promise<HooksState> => {
    const raw = hooksService.raw();
    const check = parseHookConfig(raw);
    const events = (check.config?.events ?? {}) as Record<string, unknown>;
    const counts: Record<string, number> = {};
    for (const ev of HOOK_EVENTS) {
      const groups = Array.isArray(events[ev]) ? (events[ev] as { hooks?: unknown[] }[]) : [];
      counts[ev] = groups.reduce((n, g) => n + (Array.isArray(g.hooks) ? g.hooks.length : 0), 0);
    }
    return hooksStateSchema.parse({
      raw,
      errors: check.errors,
      enabled: check.config?.enabled === true,
      filePath: hooksService.filePath(),
      counts,
    });
  };

  /* ------------------------------ 技能（W11a） ------------------------------ */

  // 技能目录在每次对话前重新扫描（毫秒级），因此**新装的技能立刻生效**，不需要重启；
  // load_skill 工具在首次刷新时注册进同一个注册表，权限门照常适用（它是只读工具）。
  const plugins = createPluginsService();
  // 技能来源 = 用户级 → 用户级插件 → 工作区级 → 工作区级插件（越靠后优先级越高）
  const skills = createSkillsService(registry, {
    sourcesFor: (workspaceRoot) => [
      { path: userSkillsDir(), origin: 'user' },
      ...plugins.skillSources(workspaceRoot),
      ...(workspaceRoot !== null ? [{ path: workspaceSkillsDir(workspaceRoot), origin: 'workspace' as const }] : []),
    ],
  });

  /** 权限规则表（W5c）：TOOL_RUN 与对话链路共用同一份，因此规则语义全进程一致 */
  const permissionRules = createFilePermissionRulesStore();
  /** 每次都重新读：规则改动必须立即生效，缓存会让用户以为删掉的规则还在拦截 */
  const loadPolicy = async (): Promise<{
    mode: PermissionMode;
    rules: PermissionRule[];
    alwaysAsk: string[];
  }> => {
    const snapshot = await readConfigSnapshot();
    return {
      mode: snapshot.config.permissionMode,
      rules: await permissionRules.list(),
      // 高危清单：引擎级兜底（命中即硬 ask）。来自配置，不经渲染层写入
      alwaysAsk: snapshot.config.alwaysAskTools,
    };
  };

  handle(IPC.APP_INFO, (): AppInfo => {
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

  handle(IPC.CONFIG_GET, async (): Promise<ConfigSnapshot> => {
    return configSnapshotSchema.parse(await readConfigSnapshot());
  });

  handle(IPC.CONFIG_SET, async (_e, patch: unknown): Promise<ConfigSnapshot> => {
    // 只接受已知字段，防止渲染层塞任意键污染配置；
    // 显式剔除 undefined 以配合 exactOptionalPropertyTypes
    const parsed = appConfigSchema.partial().parse(patch);
    const clean: Partial<AppConfig> = {};
    if (parsed.theme !== undefined) clean.theme = parsed.theme;
    // **不接受渲染层写 workspace**（2026-09-23 修）：
    // workspace 决定工具能碰哪些路径，属于权限边界的一部分；它只能由用户通过
    // 目录选择器（WORKSPACE_PICK，走主进程对话框）设置。让渲染层能改，
    // 等于把"工具可达范围"交给一段可能被注入的脚本。
    // 另外两个安全相关字段（permissionMode / alwaysAskTools）同样不在白名单里，理由相同。
    if (parsed.appearance !== undefined) {
      // 外观必须过一遍受控字段校验才允许落盘：
      // 样式包将来会喂给 CSS 变量，非法内容等于把注入面写进配置（见卡片 013 的 RCE 事件）。
      const raw = parsed.appearance.pack;
      if (raw !== null && raw !== undefined) {
        const check = validateThemePack(raw);
        if (!check.ok || !check.pack) {
          throw new Error(`外观样式包被拒绝：${check.errors.join('；')}`);
        }
        clean.appearance = { packId: parsed.appearance.packId, pack: check.pack };
      } else {
        clean.appearance = { packId: parsed.appearance.packId, pack: null };
      }
    }
    return configSnapshotSchema.parse(await writeConfig(clean));
  });

  /* ---------------------------- 内置终端（W9b） ---------------------------- */

  // 终端服务：权限门用与工具层同一个 resolver（终端归 exec 类，每次都问）
  const terminal = new TerminalService(
    (event) => {
      deps.getWindow?.()?.webContents.send(IPC.TERMINAL_STREAM, event);
    },
    // fail-closed：权限桥不可用时一律拒绝，绝不因为"取不到审批"就放行
    (req) => {
      const resolver = deps.permission?.resolve;
      if (!resolver) return Promise.resolve('deny' as const);
      return resolver(req);
    },
  );
  // 应用退出时杀掉所有 PTY，避免留下僵尸子进程
  app.on('before-quit', () => {
    terminal.disposeAll();
  });

  handle(IPC.TERMINAL_START, async (_e, payload: unknown): Promise<unknown> => {
    const parsed = terminalStartSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '终端参数不合法' };
    // 只允许在工作区内开终端：工作区不合法时直接拒绝，不静默改成别的目录
    const ws = await getWorkspaceInfo();
    if (!ws.valid) return { ok: false, error: '尚未选择工作区，无法启动终端' };
    if (parsed.data.workspaceRoot !== ws.root) {
      return { ok: false, error: '终端只能开在当前工作区内' };
    }
    return terminal.start({ workspaceRoot: ws.root, ...(parsed.data.cols !== undefined ? { cols: parsed.data.cols } : {}), ...(parsed.data.rows !== undefined ? { rows: parsed.data.rows } : {}) });
  });

  handle(IPC.TERMINAL_INPUT, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = terminalInputSchema.safeParse(payload);
    if (!parsed.success) return false;
    return terminal.write(parsed.data.sessionId, parsed.data.data);
  });

  handle(IPC.TERMINAL_RESIZE, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = terminalResizeSchema.safeParse(payload);
    if (!parsed.success) return false;
    return terminal.resize(parsed.data.sessionId, { cols: parsed.data.cols, rows: parsed.data.rows });
  });

  handle(IPC.TERMINAL_KILL, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = terminalKillSchema.safeParse(payload);
    if (!parsed.success) return false;
    return terminal.kill(parsed.data.sessionId);
  });

  /* ---------------------------- 连接管理 ---------------------------- */

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

  /* ------------------------------ 对话 ------------------------------ */

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

  /* ---------------------- W3：工作区与工具执行 ---------------------- */

  handle(IPC.WORKSPACE_GET, async () => workspaceInfoSchema.parse(await getWorkspaceInfo()));

  handle(IPC.WORKSPACE_PICK, async () =>
    workspaceInfoSchema.parse(await pickWorkspace(deps.getWindow?.())),
  );

  handle(IPC.WORKSPACE_CLEAR, async () =>
    workspaceInfoSchema.parse(await clearWorkspace()),
  );

  handle(IPC.PERMISSION_RESOLVE, async (_e, payload: unknown): Promise<boolean> => {
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

  handle(IPC.TOOL_RUN, async (_e, payload: unknown): Promise<ToolRunResult> => {
    const { toolName, args } = (payload ?? {}) as { toolName?: unknown; args?: unknown };
    if (typeof toolName !== 'string' || toolName === '') {
      throw new Error('缺少工具名');
    }

    const info = await getWorkspaceInfo();
    // MCP 工具操作的是外部服务，不需要工作区；内置文件工具才需要。
    // 若把工作区当成所有工具的前置条件，用户没选工作区时就完全用不了 MCP 工具。
    const isMcpTool = mcp.owns(toolName);
    if (!isMcpTool && (!info.root || !info.valid)) {
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

    const tool = registry.get(toolName);
    // 未选工作区时给一个不可能的根目录：内置工具会在路径守卫阶段被拒（fail closed）
    const workspaceRoot = info.root && info.valid ? info.root : '__no_workspace__';
    const policy = await loadPolicy();
    // 手动执行工具前也刷新一次：界面上的当前技能/插件必须与真实状态一致
    await plugins.refresh(info.root && info.valid ? info.root : null);
    await skills.refresh(info.root && info.valid ? info.root : null);
    const res = await runTool(tool, args ?? {}, { workspaceRoot }, deps.permission.resolve, {
      mode: policy.mode,
      rules: policy.rules,
      alwaysAsk: policy.alwaysAsk,
      hooks: hookRunner,
      sessionId: 'manual',
    });

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

  /* ------------------------------ MCP（W10e） ------------------------------ */

  handle(IPC.MCP_SERVER_LIST, async () => {
    // 先刷新插件：新装插件的贡献要立刻出现在列表里，不能等一次对话
    const wsInfo = await getWorkspaceInfo();
    await plugins.refresh(wsInfo.valid ? wsInfo.root : null);
    return z.array(mcpServerViewSchema).parse(await mcp.views());
  });

  handle(IPC.MCP_SERVER_SAVE, async (_e, input: unknown) => {
    return mcpServerViewSchema.parse(await mcp.save(input));
  });

  handle(IPC.MCP_SERVER_DELETE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcp.remove(id);
  });

  handle(IPC.MCP_CONNECT, async (_e, id: unknown): Promise<McpConnectResult> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcpConnectResultSchema.parse(await mcp.connect(id));
  });

  handle(IPC.MCP_APPROVE, async (_e, payload: unknown) => {
    const { id, choice } = (payload ?? {}) as { id?: unknown; choice?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcpApproveResultSchema.parse(await mcp.approve(id, choice));
  });

  handle(IPC.MCP_DISCONNECT, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcp.disconnect(id);
  });

  /* ------------------------------ 插件（W11b） ------------------------------ */

  handle(IPC.PLUGINS_GET, async () => {
    const ws = await getWorkspaceInfo();
    const result = await plugins.refresh(ws.valid ? ws.root : null);
    return pluginsStateSchema.parse({
      summary: plugins.summary(),
      scannedDirs: result.scannedDirs,
      plugins: result.plugins.map((pl) => ({
        name: pl.name,
        version: pl.manifest.version ?? null,
        description: pl.manifest.description ?? null,
        dir: pl.dir,
        skillsCount: pl.skillsDirs.length,
        commandsCount: pl.commandsDirs.length,
        mcpServers: pl.mcpServers.map((s) => s.name),
        diagnostics: pl.diagnostics,
      })),
      diagnostics: result.diagnostics,
    });
  });

  /* --------------------------- 生命周期钩子（W5d） --------------------------- */

  handle(IPC.HOOKS_GET, async () => await hooksState());

  handle(IPC.HOOKS_SET, async (_e, input: unknown) => {
    const saved = await hooksService.save(input);
    return hooksSaveResultSchema.parse({ ok: saved.ok, errors: saved.errors, state: await hooksState() });
  });

  /* --------------------------- 权限规则表（W5c） --------------------------- */

  handle(IPC.PERMISSION_RULES_LIST, async () => {
    return z.array(permissionRuleViewSchema).parse(await permissionRules.list());
  });

  handle(IPC.PERMISSION_RULES_ADD, async (_e, input: unknown) => {
    const parsed = permissionRuleInputSchema.parse(input);
    const record = await permissionRules.add(parsed);
    return permissionRuleViewSchema.parse(record);
  });

  handle(IPC.PERMISSION_RULES_REMOVE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少规则 id');
    return permissionRules.remove(id);
  });

  handle(IPC.PERMISSION_RULES_TOGGLE, async (_e, payload: unknown) => {
    const { id, enabled } = (payload ?? {}) as { id?: unknown; enabled?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少规则 id');
    if (typeof enabled !== 'boolean') throw new Error('缺少 enabled');
    const updated = await permissionRules.setEnabled(id, enabled);
    if (updated === null) throw new Error(`规则不存在: ${id}`);
    return permissionRuleViewSchema.parse(updated);
  });
}
