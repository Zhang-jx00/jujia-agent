import { app } from 'electron';
import { join } from 'node:path';
import { IPC, type PermissionMode, type StreamEvent } from '@jujia/shared-ipc';
import {
  createDefaultRegistry,
  createProcessHookRunner,
  rulesAreUntrusted,
  type HookRunner,
  type PermissionRule,
  type ToolRegistry,
} from '@jujia/agent-core';
import { McpService } from '../mcp/mcp-service';
import { createRealTransport } from '../mcp/real-transport';
import { createFileHooksService, type HooksService } from '../hooks-store';
import {
  createFilePermissionRulesStore,
  type PermissionRulesHealth,
  type PermissionRulesStore,
} from '../permission-rules-store';
import { createAuditService, type AuditService, type PolicyHealth } from '../audit-service';
import { createLogStore, type LogStore } from '../log-store';
import { getDataRoot } from '../paths';
import { getWorkspaceInfo } from '../workspace';
import { createPluginsService, type PluginsService } from '../plugins';
import { createSkillsService, userSkillsDir, workspaceSkillsDir, type SkillsService } from '../skills';
import { readConfigSnapshot } from '../config-store';
import type { PermissionBridge } from '../permission-bridge';
import type { HandleRegistrar } from './handle';
import { createTrustedHandle } from './handle';
import { createTurnTrigger, type TurnTrigger } from './turn-trigger';

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
  /**
   * 结构化日志的落盘（M12 批一 · R10）。**由 `main/index.ts` 建、经这里传下来** ——
   * 启动线（index.ts）与界面读尾部（ipc/logs.ts）必须落在同一本文件、
   * 共享同一份"本次运行的丢计与写失败"，各建各的实例会各写各的账。
   */
  logs?: LogStore;
}

/** 每次现读的权限上下文（缓存会让用户以为删掉的规则还在拦截） */
export interface IpcPolicy {
  mode: PermissionMode;
  rules: PermissionRule[];
  alwaysAsk: string[];
  /**
   * 规则表这次是从哪一档读出来的（审计每条都带上）。
   * `list()` 与 `health()` 是两次读，理论上会被"正好卡在中间改文件"错开 ——
   * 这是**记账 stamps**，不是判定输入，判定用的仍是上面那份 rules；可接受，写在这里备查。
   */
  rulesHealth: PermissionRulesHealth;
  /**
   * **规则表这次读不出来**（T74）⇒ 判定侧要按"非只读一律硬 ask"处理。
   *
   * 口径（R49 定的）：**`recovered` 才是"真的发生过降级/失败"**（主文件损坏 / 被截断
   * ⇒ 落到了备份档或空表 ⇒ 用户写过的 `deny` 可能根本没进这次判定），
   * 而 `source === 'default' && !recovered` 是**「从来没有规则文件」**（正常首装，**不该当成读坏了**）。
   */
  rulesUntrusted: boolean;
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
  audit: AuditService;
  logs: LogStore;
  loadPolicy: () => Promise<IpcPolicy>;
  fetchImpl: typeof fetch;
  /** 起一轮对话的唯一入口（M7 · R9）。用户敲字与定时到点共用它，见 `ipc/turn-trigger.ts` */
  startTurn: TurnTrigger;
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
    // 窗口可能已经销毁（T40：send 到已销毁的 webContents 会抛）—— 先问活着吗
    const win = deps.getWindow?.();
    if (win !== undefined && !win.isDestroyed()) win.webContents.send(IPC.MCP_STATE_CHANGED, views);
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

  /**
   * 执行审计（M4 收尾 · 其二）。
   *
   * 放在上下文里而不是各模块自建：判定出口必须**只有一个**（见 `audit-service.ts`），
   * 多处建实例会各写各的账，还会把"落盘前剔密"这件关键事复制成两份实现。
   *
   * `lastHealth` / `lastWorkspaceRoot` 由 `loadPolicy()` 刷新 —— 它是每个带权限的动作
   * 都会走的那条路，所以"记录时的健康度/工作区"与"判定时的"来自同一次读取，不会漂到别的时间点。
   */
  let lastHealth: PolicyHealth = { source: 'primary', count: 0, recovered: false };
  let lastWorkspaceRoot = '';
  const audit: AuditService = createAuditService({
    policyHealth: () => lastHealth,
    workspaceRoot: () => lastWorkspaceRoot,
  });

  /**
   * 结构化日志（M12 批一 · R10）。与审计同理放在上下文里：
   * 启动线（index.ts）、渲染层上报、界面读尾部必须落在**同一本文件**，
   * 也共享同一份"本次运行的丢计与写失败"计数 —— 各建各的实例会各写各的账。
   * `index.ts` 正常路径会显式传入它建好的那份；这里兜底只为测试。
   */
  const logs: LogStore =
    deps.logs ?? createLogStore({ dir: join(getDataRoot(), 'logs'), clock: () => new Date() });

  /** 每次现读的权限上下文（缓存会让用户以为删掉的规则还在拦截） */
  const loadPolicy = async (): Promise<IpcPolicy> => {
    const snapshot = await readConfigSnapshot();
    const [rules, rulesHealth] = await Promise.all([permissionRules.list(), permissionRules.health()]);
    // 审计记账要的两样"当时的事实"就在这里落定：规则表健康度 + 工作区根
    lastHealth = {
      source: rulesHealth.source,
      count: rules.filter((r) => r.enabled).length,
      recovered: rulesHealth.recovered,
    };
    const info = await getWorkspaceInfo();
    lastWorkspaceRoot = info.root ?? '';
    return {
      mode: snapshot.config.permissionMode,
      rules,
      rulesHealth,
      // T74：**只有 `recovered` 才算"读不出来"**（正常首装 / 正常读出 ⇒ 不触发额外询问）
      // 口径用 agent-core 的**同一个函数**（`rulesAreUntrusted`）⇒ 判定侧 / 审计侧 / 界面横幅不各写各的
      rulesUntrusted: rulesAreUntrusted(rulesHealth),
      // 高危清单：引擎级兜底（命中即硬 ask）。来自配置，不经渲染层写入
      alwaysAsk: snapshot.config.alwaysAskTools,
    };
  };

  /**
   * 起一轮对话的唯一入口（M7 · R9）。
   *
   * 放在上下文里而不是让 `ipc/chat.ts` 与定时任务各建一份：这一串参数（模式 / 规则 /
   * 高危清单 / 钩子 / 注册表 / 技能清单 / 审计出口）少传一项不会报错，只会让引擎裸奔。
   */
  const startTurn = createTurnTrigger({
    deps,
    fetchImpl,
    mcpDebug,
    plugins,
    skills,
    registry,
    hookRunner,
    loadPolicy,
    audit,
  });

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
    audit,
    logs,
    fetchImpl,
    startTurn,
    loadPolicy,
  };
}
