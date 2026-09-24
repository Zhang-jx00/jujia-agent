import { app } from 'electron';
import { IPC, type PermissionMode, type StreamEvent } from '@jujia/shared-ipc';
import {
  createDefaultRegistry,
  createProcessHookRunner,
  type HookRunner,
  type PermissionRule,
  type ToolRegistry,
} from '@jujia/agent-core';
import { McpService } from '../mcp/mcp-service';
import { createRealTransport } from '../mcp/real-transport';
import { createFileHooksService, type HooksService } from '../hooks-store';
import { createFilePermissionRulesStore, type PermissionRulesStore } from '../permission-rules-store';
import { createPluginsService, type PluginsService } from '../plugins';
import { createSkillsService, userSkillsDir, workspaceSkillsDir, type SkillsService } from '../skills';
import { readConfigSnapshot } from '../config-store';
import type { PermissionBridge } from '../permission-bridge';
import type { HandleRegistrar } from './handle';
import { createTrustedHandle } from './handle';

/** `registerIpcHandlers` 的注入面（由 main/index.ts 传入；测试用假实现驱动真实链路） */
export interface IpcDeps {
  /** 把流式事件推给渲染层（由 main/index.ts 注入，便于测试与窗口重建） */
  emitStream: (event: StreamEvent) => void;
  /** 权限审批桥（W3）：写/执行类工具经它询问用户 */
  permission: PermissionBridge;
  /** 取当前主窗口（目录选择对话框、终端流、浏览器视图都需要作为父窗口） */
  getWindow?: () => Electron.BrowserWindow | undefined;
  /** 工具注册表（默认内置文件 + exec 工具；MCP 批准后也注册到这里） */
  registry?: ToolRegistry;
  /** 测试用：覆盖 fetch */
  fetcher?: typeof fetch;
}

/** 每次现读的权限上下文（缓存会让用户以为删掉的规则还在拦截） */
export interface IpcPolicy {
  mode: PermissionMode;
  rules: PermissionRule[];
  alwaysAsk: string[];
}

/**
 * 各 ipc 模块共用的上下文。
 *
 * R-12 拆分的原则：**能共享的才共享**。这里只放"确实被两个以上模块用到"的东西
 * （注册表、MCP、插件/技能、钩子运行器、权限策略、发送方校验入口）；
 * 终端 / 浏览器 / git 的服务实例**不进上下文** —— 它们各自只被一个模块用，
 * 放在自己模块里创建，读者不用跨文件就能看清"这个服务是谁起的、什么时候销毁"。
 */
export interface IpcContext {
  deps: IpcDeps;
  handle: HandleRegistrar;
  registry: ToolRegistry;
  mcp: McpService;
  mcpDebug: (message: string) => void;
  plugins: PluginsService;
  skills: SkillsService;
  hooks: HooksService;
  hookRunner: HookRunner;
  permissionRules: PermissionRulesStore;
  loadPolicy: () => Promise<IpcPolicy>;
  fetchImpl: typeof fetch;
}

export function createIpcContext(deps: IpcDeps): IpcContext {
  /**
   * **全进程只用一个工具注册表**。
   *
   * 这是 W10e 修掉的一个接线缺陷：原先 `deps.registry ?? createDefaultRegistry()` 在
   * TOOL_RUN 与对话链路里各写一次，而未注入时会**每次调用都新建一个空注册表** ——
   * 结果是 MCP 批准后的工具注册到 A 表，工具执行时却去 B 表里查（永远查不到）。
   * 表面现象是"批准成功了但模型用不了工具"。
   */
  const registry: ToolRegistry = deps.registry ?? createDefaultRegistry();
  const fetchImpl = deps.fetcher ?? fetch;

  const mcpDebug = (message: string): void => {
    // 默认静默：第三方服务端的日志可能很吵；需要排查时设 JJ_MCP_DEBUG=1
    if (process.env['JJ_MCP_DEBUG'] === '1') console.log(message);
  };

  const plugins = createPluginsService();
  // 技能来源 = 用户级 → 用户级插件 → 工作区级 → 工作区级插件（越靠后优先级越高）
  const skills = createSkillsService(registry, {
    sourcesFor: (workspaceRoot) => [
      { path: userSkillsDir(), origin: 'user' },
      ...plugins.skillSources(workspaceRoot),
      ...(workspaceRoot !== null ? [{ path: workspaceSkillsDir(workspaceRoot), origin: 'workspace' as const }] : []),
    ],
  });

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

  /* 生命周期钩子（W5d）：load() 是异步的，而钩子默认**关闭** ——
   * 万一在读完之前就有工具调用，结果只是这次没有钩子参与，主权限门照常生效（fail-open 且有界），不是安全问题。 */
  const hooks = createFileHooksService();
  void hooks.load().catch((err: unknown) => {
    console.error('[hooks] 读取钩子配置失败：', err);
  });
  const hookRunner = createProcessHookRunner({
    getConfig: () => hooks.getConfig(),
    onDebug: mcpDebug,
  });

  const permissionRules = createFilePermissionRulesStore();

  return {
    deps,
    handle: createTrustedHandle(),
    registry,
    mcp,
    mcpDebug,
    plugins,
    skills,
    hooks,
    hookRunner,
    permissionRules,
    fetchImpl,
    loadPolicy: async (): Promise<IpcPolicy> => {
      const snapshot = await readConfigSnapshot();
      return {
        mode: snapshot.config.permissionMode,
        rules: await permissionRules.list(),
        // 高危清单：引擎级兜底（命中即硬 ask）。来自配置，不经渲染层写入
        alwaysAsk: snapshot.config.alwaysAskTools,
      };
    },
  };
}
