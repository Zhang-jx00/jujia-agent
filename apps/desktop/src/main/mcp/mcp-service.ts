/**
 * MCP 服务编排（W10e）—— 主进程里唯一持有子进程与会话的地方。
 *
 * 职责链路：配置 → 起子进程 → 握手 → 列工具 → **生成待批准计划** → 等用户逐工具同意
 * → 把批准的工具注册进工具表（走同一套权限门） → 断开时摘掉工具并退掉进程。
 *
 * 四条**安全关键**的约定（每条都有对应测试）：
 * 1. **拒绝连接必须真的退掉进程**。拒绝不只是"不接入" —— 让一个被拒绝的第三方进程
 *    继续在后台跑，与"拒绝"这个动作的语义不符。
 * 2. **进程退出必须立刻摘掉它的工具**。否则注册表里会留着"看起来可用、一调用就超时"的工具，
 *    模型会反复尝试一个已经不存在的能力。
 * 3. **每次连接都重新征得同意**（不持久化批准结果）。服务端升级后工具集合可能变化，
 *    用旧名单自动放行等于放行了一个你从没看过的工具。
 * 4. **调用时不猜归属**：按 `qualifiedName` 精确找服务端，找不到就报错；并再查一次
 *    "该工具是否在已批准集合里"——注册表是三层防线，这里不是多余的。
 *
 * 另有一个由并发暴露的坑：**generation 守卫**。
 * "断开 → 立刻重连"时旧连接的 `onExit` 回调会晚到；若不校验 generation，
 * 它会摘掉**新连接**刚注册的工具，表面现象是"工具莫名消失"。
 */

import {
  McpClient,
  applyApproval,
  extractText,
  planConnectionApproval,
  registerMcpTools,
  unregisterMcpTools,
  validateServerConfig,
  type ConnectionApprovalPlan,
  type McpFailure,
  type McpServerConfig,
  type McpToolCallResult,
  type McpToolProfile,
  type McpTransport,
  type ToolRegistry,
} from '@jujia/agent-core';
import {
  mcpApprovalChoiceSchema,
  mcpApprovalPlanSchema,
  mcpApproveResultSchema,
  mcpServerInputSchema,
  mcpServerViewSchema,
  type McpApproveResult,
  type McpConnectResult,
  type McpServerView,
  type McpState,
} from '@jujia/shared-ipc';
import type { McpStore, StoredMcpServer } from './mcp-store';

export interface McpExitInfo {
  code: number | null;
  signal: string | null;
  spawnError?: string;
}

export interface McpTransportHooks {
  onExit: (info: McpExitInfo) => void;
}

export interface McpServiceDeps {
  /** 工具注册表：批准后的 MCP 工具注册到这里，于是自动走权限门与 TOOL_RUN 链路 */
  registry: ToolRegistry;
  /** 造传输。真实实现用 createStdioTransport；测试注入假传输，因此本类可完整单测 */
  createTransport: (config: McpServerConfig, hooks: McpTransportHooks) => McpTransport;
  /**
   * 存储。省略时**懒加载**文件实现 —— 懒加载是必要的：
   * 文件实现依赖 `electron.app`，而单测跑在纯 node 环境里。
   */
  store?: McpStore;
  onDebug?: (message: string) => void;
  requestTimeoutMs?: number;
  /** 握手（initialize）专用超时；npx 首跑要下载包，默认 60s（见 McpClientOptions） */
  initializeTimeoutMs?: number;
  /**
   * **插件带来的**服务端（W11c）。
   *
   * 它们和用户自己配的走**完全一样的**连接与批准流程 —— 插件只是把"要连什么"替你写好了，
   * **不代表它有权放行**：连上之后仍然要逐工具批准。
   * 差别只在归属：这些条目不能在界面里编辑或删除（改插件清单才是正途）。
   */
  externalServers?: () => ExternalMcpServer[];
}

/** 插件声明的 MCP 服务端（配置里的变量已在插件加载阶段展开） */
export interface ExternalMcpServer {
  /** 稳定 id，形如 `plugin:<插件名>:<服务端名>` */
  id: string;
  name: string;
  pluginName: string;
  config: McpServerConfig;
  /** 插件清单把它标成 `enabled: false` */
  disabledByPlugin: boolean;
}

/** 外部服务端的 id 前缀：用它来判断"这条是不是插件给的" */
export const PLUGIN_SERVER_ID_PREFIX = 'plugin:';

interface Session {
  /** 单调递增的连接代次，用于挡住「旧连接的晚到回调」 */
  generation: number;
  client: McpClient;
  /** 本次连接发现到的全部工具（含未批准的） */
  tools: McpToolProfile[];
  /** 用户已批准、**当前真正可调用**的工具（qualifiedName） */
  enabledQualified: string[];
  /** 已注册进工具表的模型侧工具名，断开时按此摘除 */
  registeredNames: string[];
  pendingPlan: ConnectionApprovalPlan | null;
  state: McpState;
  lastError: string | null;
  /** 主动断开中：此刻收到 exit 属正常，不该报「进程意外退出」 */
  closing: boolean;
}

export class McpService {
  private readonly sessions = new Map<string, Session>();
  private generationSeq = 0;
  private changedListener: ((views: McpServerView[]) => void) | null = null;
  private storePromise: Promise<McpStore> | undefined;

  constructor(private readonly deps: McpServiceDeps) {}

  /** 取存储。未注入时懒加载文件实现（避免在纯 node 环境里解析到 electron） */
  private async store(): Promise<McpStore> {
    if (this.deps.store) return this.deps.store;
    this.storePromise ??= import('./mcp-store').then((m) => m.createFileMcpStore());
    return this.storePromise;
  }

  /** 注册状态变化回调（main 侧转发给渲染层） */
  onChanged(listener: (views: McpServerView[]) => void): void {
    this.changedListener = listener;
  }

  private debug(message: string): void {
    this.deps.onDebug?.(message);
  }

  /** 状态变化即广播：**异步失败也要可见**，不能静默吞掉 */
  private notify(): void {
    const listener = this.changedListener;
    if (!listener) return;
    void this.views()
      .then(listener)
      .catch((err: unknown) => this.debug(`广播 MCP 状态失败：${err instanceof Error ? err.message : String(err)}`));
  }

  async views(): Promise<McpServerView[]> {
    const records = await (await this.store()).list();
    const external = this.deps.externalServers?.() ?? [];
    // 用户自己配的在前，插件带来的在后；两者同 id 时**用户配置优先**（见 resolveServer 的说明）
    const storedIds = new Set(records.map((r) => r.id));
    return [
      ...records.map((r) => this.viewOf(r)),
      ...external.filter((e) => !storedIds.has(e.id)).map((e) => this.viewOfExternal(e)),
    ];
  }

  private viewOf(record: StoredMcpServer): McpServerView {
    const session = this.sessions.get(record.id);
    return mcpServerViewSchema.parse({
      id: record.id,
      name: record.name,
      command: record.command,
      args: record.args,
      // 只给键名，绝不带值
      envKeys: Object.keys(record.env),
      state: session?.state ?? 'idle',
      discoveredTools: session?.tools.length ?? 0,
      enabledTools: session?.enabledQualified ?? [],
      lastError: session?.lastError ?? null,
      source: 'user',
      pluginName: null,
      disabledByPlugin: false,
    });
  }

  private viewOfExternal(external: ExternalMcpServer): McpServerView {
    const session = this.sessions.get(external.id);
    return mcpServerViewSchema.parse({
      id: external.id,
      name: external.name,
      command: external.config.command,
      args: external.config.args,
      envKeys: Object.keys(external.config.env ?? {}),
      state: session?.state ?? 'idle',
      discoveredTools: session?.tools.length ?? 0,
      enabledTools: session?.enabledQualified ?? [],
      lastError: session?.lastError ?? null,
      source: 'plugin',
      pluginName: external.pluginName,
      disabledByPlugin: external.disabledByPlugin,
    });
  }

  /**
   * 按 id 找服务端：先找用户配置，再找插件带来的。
   *
   * 同 id 时**用户配置优先**是有意为之：万一插件用了一个和用户配置撞名的 id，
   * 也不能让插件悄悄顶掉用户自己的配置 —— 那种"我的配置凭空变了"最难排查。
   */
  private async resolveServer(
    id: string,
  ): Promise<{ kind: 'user'; record: StoredMcpServer } | { kind: 'plugin'; external: ExternalMcpServer } | null> {
    const record = await (await this.store()).find(id);
    if (record) return { kind: 'user', record };
    const external = (this.deps.externalServers?.() ?? []).find((e) => e.id === id);
    return external ? { kind: 'plugin', external } : null;
  }

  /* ------------------------------ 配置 ------------------------------ */

  /** 新增或更新配置。命令/参数/环境变量变了 → **必须先断开旧连接**（旧进程跑的已不是这份配置） */
  async save(input: unknown): Promise<McpServerView> {
    const parsed = mcpServerInputSchema.parse(input);
    // 带了 id 就可能是"在改一个插件带来的服务端" —— 明确拒绝（改插件清单才是正途）
    if (parsed.id !== undefined && parsed.id.startsWith(PLUGIN_SERVER_ID_PREFIX)) {
      this.assertEditable(parsed.id, '修改');
    }

    // 与 agent-core 共用同一套校验：**含 shell 元字符的命令/参数一律拒绝**。
    // 这里必须再走一遍 —— IPC 入参来自渲染层，不能假定它已经过滤过。
    const check = validateServerConfig({
      id: parsed.id ?? 'pending',
      name: parsed.name,
      command: parsed.command,
      args: parsed.args,
      // 校验时把"省略 env"当作空对象看：省略只是编辑语义，与合法性无关
      env: parsed.env ?? {},
    });
    if (!check.ok) throw new Error(`服务端配置被拒绝：${check.errors.join('；')}`);

    const { record, launchChanged } = await (await this.store()).upsert(parsed);
    if (launchChanged) await this.disconnect(record.id);
    this.notify();
    return this.viewOf(record);
  }

  /** 删除：先断开（摘工具 + 退进程），再从存储里删 */
  async remove(id: string): Promise<boolean> {
    this.assertEditable(id, '删除');
    await this.disconnect(id);
    const removed = await (await this.store()).remove(id);
    this.notify();
    return removed;
  }

  /**
   * 插件带来的服务端**不能在应用里改或删**。
   *
   * 理由不是"权限不够"，而是"改了也没用"：它们的定义在插件清单里，
   * 插件一更新你的修改就被覆盖 —— 用户会以为是应用丢了配置，最难排查。
   * 所以宁可明确拒绝，并告诉他正途是改插件清单。
   */
  private assertEditable(id: string, action: string): void {
    const external = (this.deps.externalServers?.() ?? []).find((e) => e.id === id);
    if (external) {
      throw new Error(
        `「${external.name}」来自插件「${external.pluginName}」，不能在应用里${action} —— ` +
          '请改那个插件的清单（plugin.json 的 mcpServers），或在插件页里停用它。',
      );
    }
  }

  /* ------------------------------ 连接 ------------------------------ */

  async connect(id: string): Promise<McpConnectResult> {
    const target = await this.resolveServer(id);
    if (!target) throw new Error(`MCP 服务端不存在: ${id}`);

    // 插件把它标成未启用 → 明确拒绝并说明原因，而不是"点了一下没反应"
    if (target.kind === 'plugin' && target.external.disabledByPlugin) {
      throw new Error(
        `这个服务端在插件「${target.external.pluginName}」的清单里被标为未启用（enabled: false），` +
          '所以不能连接。要使用它请改那个插件的清单。',
      );
    }

    // 先彻底断掉旧连接：否则会有两个进程同时跑，且工具重名会让第二次注册被跳过
    await this.disconnect(id);

    const generation = (this.generationSeq += 1);
    // 用户配置与插件配置在这里汇成同一个形状 —— 之后的流程（握手、批准、权限门）**完全一致**
    const config: McpServerConfig =
      target.kind === 'user'
        ? {
            id: target.record.id,
            name: target.record.name,
            command: target.record.command,
            args: [...target.record.args],
            env: { ...target.record.env },
          }
        : {
            id: target.external.id,
            name: target.external.name,
            command: target.external.config.command,
            args: [...target.external.config.args],
            env: { ...target.external.config.env },
          };

    const transport = this.deps.createTransport(config, {
      onExit: (info) => this.handleExit(config.id, generation, info),
    });
    const client = new McpClient(transport, {
      ...(this.deps.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.deps.requestTimeoutMs } : {}),
      ...(this.deps.initializeTimeoutMs !== undefined
        ? { initializeTimeoutMs: this.deps.initializeTimeoutMs }
        : {}),
      onDebug: (m) => this.debug(`[mcp:${config.id}] ${m}`),
    });

    const session: Session = {
      generation,
      client,
      tools: [],
      enabledQualified: [],
      registeredNames: [],
      pendingPlan: null,
      state: 'connecting',
      lastError: null,
      closing: false,
    };
    this.sessions.set(config.id, session);
    this.notify();

    try {
      await client.connect();
      // 前缀必须用**我们配置的 id**，不能用服务端自报的名字 ——
      // 否则两个自报同名的服务端会撞成同一组 qualifiedName，后者的工具会被静默跳过
      const tools = await client.listTools(config.id);
      session.tools = tools;
      session.pendingPlan = planConnectionApproval(config, tools);
      session.state = 'awaiting_approval';
      this.notify();
      // 用 shared-ipc 的 schema 再校验一次：agent-core 与 shared-ipc 两处形状若漂移，
      // 这里立刻抛错，而不是把字段对不上的对象发给 UI（UI 只会显示成一片空白，极难排查）
      return { ok: true, plan: mcpApprovalPlanSchema.parse(session.pendingPlan) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      session.state = 'error';
      session.lastError = message;
      // 握手/列工具失败 → 必须真的退掉进程，不能留一个连不上的第三方进程在跑
      this.teardown(config.id, session);
      this.notify();
      return { ok: false, error: message };
    }
  }

  /**
   * 回填用户的批准选择。
   * 未批准的工具**不进注册表**（因此没有调用路径）；批准的进注册表并走同一套权限门。
   */
  async approve(id: string, choice: unknown): Promise<McpApproveResult> {
    const parsed = mcpApprovalChoiceSchema.parse(choice);
    const session = this.sessions.get(id);
    const plan = session?.pendingPlan;
    if (!session || !plan) {
      throw new Error('该服务端当前没有待批准的连接请求（请先点击「连接」）');
    }

    const outcome = applyApproval(plan, parsed);

    if (!outcome.approved) {
      // 拒绝 → 真的退掉进程（见文件头第 1 条）
      this.teardown(id, session);
      session.state = 'idle';
      session.pendingPlan = null;
      session.tools = [];
      this.notify();
      return mcpApproveResultSchema.parse({
        approved: false,
        enabledTools: [],
        note: outcome.note,
        registered: [],
        skipped: [],
      });
    }

    const report = registerMcpTools(this.deps.registry, session.tools, outcome, {
      callTool: (qualifiedName, args) => this.callTool(qualifiedName, args),
    });

    session.enabledQualified = outcome.enabledTools;
    session.registeredNames = report.registered;
    session.pendingPlan = null;

    // 批准了但一个都没注册成功（例如模型侧工具名全部清洗失败或全部重名）：
    // 这种「看起来连上了、其实没有任何工具可用」必须如实说出来，不能报成功让人以为能用了
    if (report.registered.length === 0) {
      session.state = 'error';
      session.lastError =
        `已批准 ${outcome.enabledTools.length} 个工具，但都无法注册进工具表：` +
        report.skipped.map((s) => `${s.name}（${s.reason}）`).join('；');
      this.teardown(id, session);
      this.notify();
      return mcpApproveResultSchema.parse({
        approved: true,
        enabledTools: [],
        note: `${outcome.note}。但没有任何工具注册成功，当前没有可用的外部工具。`,
        registered: [],
        skipped: report.skipped,
      });
    }

    session.state = 'connected';
    this.notify();
    return mcpApproveResultSchema.parse({
      approved: true,
      enabledTools: outcome.enabledTools,
      note: outcome.note,
      registered: report.registered,
      skipped: report.skipped,
    });
  }

  /** 断开：摘工具 + 退进程。返回是否真的断开了一个存在的连接 */
  async disconnect(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.teardown(id, session);
    // 先删除会话再广播：否则 viewOf 会读到一个已经清空的会话，UI 上会闪出一次错误的中间态
    this.sessions.delete(id);
    this.notify();
    return true;
  }

  /** 应用退出时调用 */
  /**
   * 当前挂着"待你批准"计划的服务端（外部审查 T9）：没有则 null。
   * 批准一旦做出（或拒绝），`pendingPlan` 就置空，这里自然也不再返回。
   */
  pendingApproval(): { id: string; plan: ConnectionApprovalPlan } | null {
    for (const [id, session] of this.sessions) {
      if (session.pendingPlan !== null) return { id, plan: session.pendingPlan };
    }
    return null;
  }

  disposeAll(): number {
    const count = this.sessions.size;
    for (const [id, session] of [...this.sessions]) {
      this.teardown(id, session);
      this.sessions.delete(id);
    }
    return count;
  }

  /** 某个模型侧工具名是否由本服务注册（用于区分"需要工作区"的内置工具与外部工具） */
  owns(modelToolName: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.registeredNames.includes(modelToolName)) return true;
    }
    return false;
  }

  /* ---------------------------- 工具调用 ---------------------------- */

  /**
   * 供工具桥回调的调用入口。
   * 两道校验：① 精确匹配归属服务端（**不猜**）；② 必须在已批准集合里。
   */
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    for (const [serverId, session] of this.sessions) {
      const profile = session.tools.find((t) => t.qualifiedName === qualifiedName);
      if (!profile) continue;

      if (!session.enabledQualified.includes(qualifiedName)) {
        // 理论上未批准的工具不会进注册表，这里仍然拦一次：注册表是防线，不是唯一防线
        return { ok: false, text: `工具 ${qualifiedName} 未被批准启用，已拒绝调用` };
      }
      if (session.state !== 'connected') {
        // 拒绝的理由要连"上次为什么失败"一起给出：只说"不可用"，模型和人都只能猜
        const why = session.lastError === null ? '' : `；上次失败：${session.lastError}`;
        return { ok: false, text: `服务端「${profile.serverId}」当前不可用（状态：${session.state}${why}）` };
      }

      const outcome = await session.client.callTool(profile.rawName, args);
      if (!outcome.ok) {
        const reason = outcome.error ?? '调用失败（服务端未给出原因）';
        this.recordCallFailure(serverId, session, reason, outcome.failure);
        return { ok: false, text: reason };
      }
      const result = outcome.result as { content?: unknown } | null | undefined;
      return { ok: true, text: extractText(result?.content) };
    }

    // 找不到归属就报错，绝不"挑一个相近的服务端试试"——那等于绕开批准边界
    return { ok: false, text: `没有任何已连接的服务端提供工具 ${qualifiedName}（可能已断开）` };
  }

  /* ------------------------------ 内部 ------------------------------ */

  /**
   * 把一次调用的结果**如实写回会话状态**（外部审查 T31）。
   *
   * 只有"什么响应都没收到"（`transport` = 请求超时）才算僵而不退：进程还在、却不应声，
   * 这时继续报 `connected` 是说假话，而且每一次调用都要再等满一个超时才失败。
   * 反过来，服务端回了错误（`protocol`）或工具自述失败（`tool`）都证明**它还在说话** ——
   * 那种情况只记原因、不改状态，否则一个远端工具的普通报错就会把整个服务端标成不可用，
   * 那是另一种不诚实。
   *
   * 不摘工具：进程还活着，工具"以不可用 + 为什么"的样子出现，比莫名消失更符合事实
   * （对比 `handleExit` —— 那里进程真没了，留着工具才是骗模型）。
   */
  private recordCallFailure(
    serverId: string,
    session: Session,
    reason: string,
    failure: McpFailure | undefined,
  ): void {
    // 进程已经退出（`exited`）是**更精确的事实**：那条在途请求的超时只是它的后果。
    // 不加这一句就会把"退出码 7"盖成"请求超时"——状态反而变得更有解释力（实测由本轮测试抓到）。
    if (session.state === 'exited') return;
    session.lastError = reason;
    // 迟到的失败回调不能污染已经重连/已断开的会话（与 generation 守卫同一类时序问题）
    if (failure === 'transport' && !session.closing && this.sessions.get(serverId) === session) {
      session.state = 'error';
    }
    this.notify();
  }

  /** 收尾：摘工具 + 释放客户端。幂等（重复调用无副作用） */
  private teardown(id: string, session: Session): void {
    session.closing = true;
    if (session.registeredNames.length > 0) {
      unregisterMcpTools(this.deps.registry, session.registeredNames);
      session.registeredNames = [];
    }
    session.enabledQualified = [];
    try {
      session.client.dispose();
    } catch (err) {
      this.debug(`[mcp:${id}] 释放客户端时报错（已忽略）：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 子进程退出。**必须先校验 generation**，否则旧连接的晚到回调会摘掉新连接的工具 */
  private handleExit(id: string, generation: number, info: McpExitInfo): void {
    const session = this.sessions.get(id);
    if (!session || session.generation !== generation) return;
    if (session.closing) return; // 主动断开触发的退出，不算异常

    session.state = 'exited';
    session.lastError =
      info.spawnError ??
      `子进程已退出（code=${info.code === null ? 'null' : String(info.code)}${
        info.signal ? `，signal=${info.signal}` : ''
      }）`;

    if (session.registeredNames.length > 0) {
      unregisterMcpTools(this.deps.registry, session.registeredNames);
      session.registeredNames = [];
      session.enabledQualified = [];
    }
    this.notify();
  }
}
