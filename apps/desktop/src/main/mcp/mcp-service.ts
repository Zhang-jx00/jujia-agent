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
 *
 * 第五条约定（R52 · T31 选项 B）：**掉线后可以自动重连，但重连仍要重新批准。**
 * 自动重连只免掉"再点一次连接"，**不免掉"再批一次工具"** ——
 * 落盘的白名单默认关、最多试 3 次、退避 2s/8s/30s，详见本文件下方「自动重连」一节。
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

/* ------------------------------------------------------------------ *
 * 自动重连（T31 · 选项 B · R52）
 * ------------------------------------------------------------------ *
 *
 * **只做「掉线后可以自动重连」，但重连仍然要重新批准。**
 *
 * 四条边界（写死在这里，免得将来被"顺手优化"掉）：
 * 1. **白名单式、默认关**：只有用户自己勾了 `autoReconnect` 的服务端才重连；
 *    插件带来的服务端没有这一格（它们由插件清单决定）⇒ 永不自动重连。
 * 2. **有上限、有退避**：最多 {@link RECONNECT_MAX_ATTEMPTS} 次；
 *    第 1/2/3 次尝试之前分别等 {@link RECONNECT_BACKOFF_MS}。
 *    用尽后**放弃**、会话留在 `error`，并说清"已试 N 次、最后一次因为什么失败"。
 * 3. **不跨应用重启**：落盘的只是「允许重连」这个**偏好**，**不是待重连的任务**
 *    ⇒ 启动时没有任何待办，本模块也就无从自动起进程。
 * 4. **重连仍要重新批准**：重连走的是**完整连接流程**（`connectInternal`），
 *    因此新会话必然停在 `awaiting_approval`、已启用工具为空 ——
 *    这一点由 {@link McpService.assertReconnectNeedsApproval} 在运行期钉住，
 *    由测试钉住"不许给重连开复用上次批准的捷径"。
 */

/** 最多自动重连几次（用尽即放弃） */
export const RECONNECT_MAX_ATTEMPTS = 3;

/**
 * 退避表（毫秒）：**第 N 次尝试之前**等这么久。
 *
 * 口径原文是"退避 2s → 8s → 30s；第三次后放弃"——三个退避值配三次尝试，
 * 唯一自洽的读法是"第 1 次等 2s、第 2 次等 8s、第 3 次等 30s"：
 * 若改成"失败之后才等"，30s 那一档永远用不上。
 */
export const RECONNECT_BACKOFF_MS = [2_000, 8_000, 30_000] as const;

/**
 * 「这一轮让位」的固定说法。
 *
 * 用固定文案（而不是随手拼一句）是为了让**调用方能精确识别**它：
 * 自动重连遇到它 ⇒ 收手、不计失败、不再重试（用户已经接管了）。
 */
export const RECONNECT_YIELDED = '自动重连让位给用户的手动连接';

/** 一个服务端的重连轮次（一次掉线 ⇒ 一轮；轮次结束就丢弃） */
interface ReconnectState {
  /** 已经发起过的自动连接次数（0 = 还没试过） */
  attempt: number;
  /** 当前阶段 */
  phase: 'waiting' | 'attempting' | 'awaiting' | 'gave_up' | 'cancelled';
  /** 排队中的定时器（等下一次尝试） */
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * 本轮期望看到的会话对象。
   *
   * 用途：**判定"用户是否已经接管"**。若它已经不是当前会话了
   * （用户自己点了连接、删了服务端、改了启动命令……），自动重连就**让位**，
   * 绝不去动用户手上那条连接。
   */
  expected: Session | null;
  /** 最后一次失败原因 */
  lastError: string | null;
  /** 已被取消（用户接管 / 授权被收回）——即使状态对象已从表里移除也仍然作数 */
  cancelled: boolean;
}

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
  /** 每个服务端的重连轮次（不在表里 = 没有待办的重连） */
  private readonly reconnects = new Map<string, ReconnectState>();
  /** 正在连接中的服务端（计数）：用来判断"用户此刻正在驱动"，自动重连要让位 */
  private readonly connecting = new Map<string, number>();
  /**
   * **用户意图的序号**：只有"用户点连接"会加它。
   *
   * 用途：自动重连发起连接时记下当时的序号；若期间用户又点了一次连接
   * （序号变了）⇒ 自动重连是**过时的那一个** ⇒ 让位，不去覆盖用户那条。
   */
  private readonly userConnectSeq = new Map<string, number>();

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
      // 重连的次数与原因**复用这一格**（不新开一格，免得同一个失败出现在两处）
      lastError: this.composeLastError(record.id, session),
      // 白名单那一格：默认关（落盘侧写死）
      autoReconnect: record.autoReconnect === true,
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
      lastError: this.composeLastError(external.id, session),
      // 插件带来的服务端**没有这一格**（由插件清单决定）⇒ 永不自动重连
      autoReconnect: false,
      source: 'plugin',
      pluginName: external.pluginName,
      disabledByPlugin: external.disabledByPlugin,
    });
  }

  /**
   * 把「重连情况」与「上次失败原因」合成**一格** `lastError`。
   *
   * 为什么不新开一格：同一个失败出现在两个地方，迟早会对不上（界面上两处说法不一致）。
   * 为什么重连信息要进 `lastError` 这一格：界面上"状态标签 + 这行字"已经是现成的两处，
   * 多开一格就得在渲染层再加一行，收益只是排版。
   */
  private composeLastError(id: string, session: Session | undefined): string | null {
    const note = this.reconnectNote(id);
    const reason = session?.lastError ?? null;
    if (note === null) return reason;
    if (reason === null) return note;
    return `${note} · 上次失败：${reason}`;
  }

  /** 这一格给用户看的重连说明（没有轮次 = null） */
  private reconnectNote(id: string): string | null {
    const st = this.reconnects.get(id);
    if (!st) return null;
    switch (st.phase) {
      case 'waiting':
        return `自动重连：第 ${st.attempt}/${RECONNECT_MAX_ATTEMPTS} 次尝试已排队`;
      case 'attempting':
        return `自动重连：正在做第 ${st.attempt}/${RECONNECT_MAX_ATTEMPTS} 次尝试`;
      case 'awaiting':
        return `自动重连：已重新连上（第 ${st.attempt} 次尝试），仍需你重新批准工具`;
      case 'gave_up':
        return `自动重连：已试 ${st.attempt} 次都没成功，已放弃（最后一次：${st.lastError ?? '未说明原因'}）`;
      case 'cancelled':
        return '自动重连：已取消（你已收回授权）';
    }
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

    // 改动前的白名单状态（用来判"授权被收回"）
    const before = parsed.id === undefined ? undefined : await (await this.store()).find(parsed.id);
    const wasAllowed = before?.autoReconnect === true;
    const nowAllowed = parsed.autoReconnect === undefined ? wasAllowed : parsed.autoReconnect;

    const { record, launchChanged } = await (await this.store()).upsert(parsed);
    if (launchChanged) await this.disconnect(record.id);

    if (parsed.id !== undefined && wasAllowed !== nowAllowed) {
      if (nowAllowed) {
        // 刚打开白名单：**没有待办的重连**（落盘的只是"允许"这个偏好，不是任务）
        this.clearReconnect(record.id);
      } else {
        // **授权被收回** ⇒ 正在排队的重连立刻取消（不再重试），并留一句给界面看
        this.markReconnectCancelled(record.id);
      }
    }

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

  /**
   * 用户点「连接」。
   *
   * **用户的动作永远压过自动化**：进连接流程之前先把排队中的自动重连撤掉 ——
   * 否则用户刚点完连接，两秒后自动重连又把他这条连接断掉重连一遍。
   */
  async connect(id: string): Promise<McpConnectResult> {
    this.clearReconnect(id);
    // **用户意图的序号**：只有"用户点连接"会加它。
    // 自动重连据此判断"用户是不是在我连的时候也点了一下" ⇒ 让位（用户永远压过自动化）。
    const seq = (this.userConnectSeq.get(id) ?? 0) + 1;
    this.userConnectSeq.set(id, seq);
    return this.connectInternal(id, { expectUserSeq: seq });
  }

  /**
   * 真正的连接流程 —— 用户点连接与**自动重连共用这一条路径**。
   *
   * 为什么不分叉出一条"自动专用"的连接流程：分叉就等于给自动重连开一条
   * "可以不走批准"的捷径 —— 那正是本产品最不能出现的事。
   * 只留一条路，重连也必然落到 `awaiting_approval`（见 `reconnectApprovalViolation`）。
   *
   * `opts.onlySession` 是**自动重连专用的那把钥匙**：它让重连
   * **只断自己那条旧会话**，绝不碰用户手上正在用的那条。
   */
  private async connectInternal(
    id: string,
    opts: { onlySession?: Session; expectUserSeq?: number } = {},
  ): Promise<McpConnectResult> {
    const target = await this.resolveServer(id);
    if (!target) throw new Error(`MCP 服务端不存在: ${id}`);

    // 插件把它标成未启用 → 明确拒绝并说明原因，而不是"点了一下没反应"
    if (target.kind === 'plugin' && target.external.disabledByPlugin) {
      throw new Error(
        `这个服务端在插件「${target.external.pluginName}」的清单里被标为未启用（enabled: false），` +
          '所以不能连接。要使用它请改那个插件的清单。',
      );
    }

    this.connecting.set(id, (this.connecting.get(id) ?? 0) + 1);
    try {
      /**
       * 先彻底断掉旧连接：否则会有两个进程同时跑，且工具重名会让第二次注册被跳过
       *
       * **自动场景下这一步安全吗？**（口径要求核清，见 docs/DESIGN-T31-PROBE-RECONNECT.md）
       * 安全，而且是**按身份**安全的 —— 三条一起看：
       * ① 自动重连**只从"已经掉线"的会话触发**（进程已退出 / 调用超时不应声）——
       *    那条会话本来就不可用了（`callTool` 在 state≠connected 时直接拒绝），
       *    所以这一步断的不是"用户正在用的连接"，而是"已经坏掉的那条"。
       * ② **只断自己那条**（`onlySession`）：若此刻表里那条已经不是"我以为要断的那条"
       *    （= 用户刚自己连过），就**直接让位** —— 一个进程都不起，更不会去动用户那条。
       * ③ 用户点「连接」会**先撤掉排队的自动重连**（`clearReconnect`），
       *    所以"用户刚点完、自动重连又来一遍"这件事不会发生。
       */
      const current = this.sessions.get(id);
      if (opts.onlySession !== undefined && current !== undefined && current !== opts.onlySession) {
        // 表里那条不是我要断的 ⇒ 用户已经接管了 ⇒ 这一轮让位
        return { ok: false, error: RECONNECT_YIELDED };
      }
      await this.disconnectInternal(id, opts.onlySession);

      // 断的过程中用户又点了一次连接 ⇒ 我是过时的那一个 ⇒ 让位（不去覆盖用户那条）
      if (opts.expectUserSeq !== undefined && this.userConnectSeq.get(id) !== opts.expectUserSeq) {
        return { ok: false, error: RECONNECT_YIELDED };
      }

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
        ...(this.deps.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: this.deps.requestTimeoutMs }
          : {}),
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
        /**
         * 握手期间若有人抢先设了别的会话（用户在同一瞬间也点了连接）⇒
         * 我是那个被顶掉的 ⇒ **把刚起的进程退掉**（别留一个没人管的第三方进程），
         * 并且不去抢当前那条会话。
         */
        if (this.sessions.get(config.id) !== session) {
          this.teardown(config.id, session);
          return { ok: false, error: RECONNECT_YIELDED };
        }
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
    } finally {
      const left = (this.connecting.get(id) ?? 1) - 1;
      if (left <= 0) this.connecting.delete(id);
      else this.connecting.set(id, left);
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
    // 重连轮次到此结束：用户已经批过了，这一轮的目的达成。
    // （此后若再掉线，会按新的轮次重新计数 —— 上限是"每次掉线最多 3 次"，不是"一辈子 3 次"）
    this.clearReconnect(id);
    this.notify();
    return mcpApproveResultSchema.parse({
      approved: true,
      enabledTools: outcome.enabledTools,
      note: outcome.note,
      registered: report.registered,
      skipped: report.skipped,
    });
  }

  /**
   * 用户点「断开」。**用户的动作压过自动化** ⇒ 排队中的自动重连一并取消。
   *
   * 不取消会怎样：用户明明断开了，两秒后自动重连又把它连回来 ——
   * 那等于"用户说不要，系统替他决定要"。
   */
  async disconnect(id: string): Promise<boolean> {
    this.clearReconnect(id);
    return this.disconnectInternal(id);
  }

  /**
   * 断开：摘工具 + 退进程。返回是否真的断开了一个存在的连接
   *
   * `only` 是**自动重连专用的那把钥匙**：只断**指定的那一条**会话。
   * 若表里那条已经换了人（用户自己连过了），就**一条都不动** ——
   * 这一句就是"自动重连不会静默杀掉用户正在用的连接"的落点。
   */
  private async disconnectInternal(id: string, only?: Session): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (only !== undefined && session !== only) return false; // 不是我要断的那条 ⇒ 不动
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
    // 应用退出：排队的自动重连也一并撤掉（别在退出后还去起第三方进程）
    for (const id of [...this.reconnects.keys()]) this.clearReconnect(id);
    return count;
  }

  /* ------------------------- 自动重连（T31 · 选项 B） ------------------------- */

  /**
   * 这个服务端在不在「掉线后自动重连」白名单里。
   *
   * **默认关**，判定只认**落盘的那一格**（`StoredMcpServer.autoReconnect`）：
   * 插件带来的服务端没有这一格（由插件清单决定）⇒ 永不自动重连。
   */
  private async autoReconnectAllowed(id: string): Promise<boolean> {
    const record = await (await this.store()).find(id);
    return record?.autoReconnect === true;
  }

  /**
   * 掉线了 —— 要不要排一次自动重连？
   *
   * **只在两种事实下触发**（口径：掉线是被"用"出来的，不是被"测"出来的 ⇒ **不做后台探活**）：
   * - 进程真的退了（`handleExit`）
   * - 一次调用什么都没等到（`recordCallFailure` 的 transport 超时 ⇒ 僵而不退）
   *
   * **不触发**的情况：用户主动断开、手动连接握手失败、服务端自己回了错（那证明它还在说话）。
   */
  private noteDrop(id: string, session: Session): void {
    const st = this.reconnects.get(id);
    if (st) {
      // 正在尝试中时掉线 —— 那就是**这次尝试自己的结果**，由尝试的收尾统一处理；
      // 这里再推一把会把"最多 3 次"算错。
      if (st.phase === 'attempting') return;
      st.expected = session;
      void this.advanceReconnect(id, st);
      return;
    }
    // 先同步占位：两次掉线连着来时，第二次不能因为"表里还没有轮次"而再开一轮
    const fresh: ReconnectState = {
      attempt: 0,
      phase: 'waiting',
      timer: null,
      expected: session,
      lastError: null,
      cancelled: false,
    };
    this.reconnects.set(id, fresh);
    void this.armReconnect(id, fresh);
  }

  /** 白名单核一遍：不在表里就**根本不起这一轮**（默认关 = 大多数情况到此为止） */
  private async armReconnect(id: string, st: ReconnectState): Promise<void> {
    if (st.cancelled) return;
    if (!(await this.autoReconnectAllowed(id))) {
      this.clearReconnect(id);
      return;
    }
    await this.advanceReconnect(id, st);
  }

  /**
   * 推进一轮：要么排下一次尝试，要么放弃。
   *
   * 退避表是"**第 N 次尝试之前**等这么久"：2s → 8s → 30s，配三次尝试。
   * 用尽 {@link RECONNECT_MAX_ATTEMPTS} 次 ⇒ 放弃、会话留在 `error`。
   */
  private async advanceReconnect(id: string, st: ReconnectState): Promise<void> {
    if (st.cancelled) return;
    if (st.attempt >= RECONNECT_MAX_ATTEMPTS) {
      this.giveUpReconnect(id, st);
      return;
    }
    st.attempt += 1;
    st.phase = 'waiting';
    const delay =
      RECONNECT_BACKOFF_MS[st.attempt - 1] ??
      RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1] as number;
    st.timer = setTimeout(() => {
      void this.runReconnectAttempt(id, st);
    }, delay);
    this.notify();
  }

  /**
   * 真正发起一次自动重连。
   *
   * 闸门（任何一道不过就**让位**，不做任何事）：
   * ① 这一轮没被取消；② 白名单还在（授权可随时收回）；③ 用户此刻没在驱动；
   * ④ 用户没有接管这条连接（会话对象比对）。
   *
   * 真正起连接时还有**两道身份闸**在 `connectInternal` 里：
   * **只断自己那条**（`onlySession`）与**用户序号**（`expectUserSeq`）。
   */
  private async runReconnectAttempt(id: string, st: ReconnectState): Promise<void> {
    st.timer = null;
    if (st.cancelled) return;

    // 授权可能刚被收回 ⇒ **起进程之前**再核一次（不能只信发起时那一眼）
    if (!(await this.autoReconnectAllowed(id))) {
      this.markReconnectCancelled(id);
      return;
    }
    // 用户此刻正在驱动（自己点了连接）⇒ 自动重连让位，不去动他手上那条
    if ((this.connecting.get(id) ?? 0) > 0) {
      this.clearReconnect(id);
      return;
    }
    // 用户已经接管了这条连接（手动连过 / 删了 / 改了启动命令）⇒ 让位
    if (this.sessions.get(id) !== st.expected) {
      this.clearReconnect(id);
      return;
    }

    st.phase = 'attempting';
    this.notify();

    // **走的是完整连接流程**（与用户点「连接」同一条路径）⇒ 必然要重新批准。
    // `onlySession` = 只断自己那条旧会话；`expectUserSeq` = 用户又点了就让位。
    const result = await this.connectInternal(id, {
      onlySession: st.expected ?? undefined,
      expectUserSeq: this.userConnectSeq.get(id) ?? 0,
    });
    if (st.cancelled) return; // 期间用户接管了 ⇒ 这一轮作废，不再推进
    st.expected = this.sessions.get(id) ?? null;

    if (result.ok) {
      // 握手成功。但**还不算数**：新会话必须停在"待你批准"、一个工具都没启用
      const violation = this.reconnectApprovalViolation(this.sessions.get(id));
      if (violation !== null) {
        st.lastError = violation;
        st.phase = 'waiting';
        await this.advanceReconnect(id, st);
        return;
      }
      st.lastError = null;
      st.phase = 'awaiting';
      this.notify();
      return;
    }

    // 「让位」不是失败：用户已经接管了 ⇒ 收手，不计次数、不再重试
    if (result.error === RECONNECT_YIELDED) {
      this.clearReconnect(id);
      return;
    }

    st.lastError = result.error;
    st.phase = 'waiting';
    await this.advanceReconnect(id, st);
  }

  /**
   * 源锁：重连出来的会话**必须**停在 `awaiting_approval`、且**已启用工具为空**。
   *
   * 防的是将来有人给重连开一条"复用上次批准"的捷径 —— 那才是真正的风险
   * （"每次连接都重新征得同意"是本产品的红线）。
   * 返回 null = 没问题；返回字符串 = 内部不变量被破坏（这一轮不算成功）。
   */
  private reconnectApprovalViolation(session: Session | undefined): string | null {
    if (!session) return '重连之后没有会话';
    if (session.state !== 'awaiting_approval') {
      return `重连后的会话状态是 ${session.state}，不是「待你批准」`;
    }
    if (session.enabledQualified.length > 0) {
      return `重连后的会话已经启用了 ${session.enabledQualified.length} 个工具（必须一个都没有）`;
    }
    return null;
  }

  /** 用尽上限：放弃，留在 `error`（不新增状态值），并把"已试 N 次、最后一次因为什么失败"说清楚 */
  private giveUpReconnect(id: string, st: ReconnectState): void {
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    st.phase = 'gave_up';
    const session = this.sessions.get(id);
    if (session) session.state = 'error';
    this.notify();
  }

  /** 彻底撤掉一轮（用户接管 / 服务端没了 / 不在白名单） */
  private clearReconnect(id: string): void {
    const st = this.reconnects.get(id);
    if (!st) return;
    st.cancelled = true;
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    this.reconnects.delete(id);
  }

  /** 授权被收回：撤掉排队中的重连，但**留一句**给界面看（"看得见"是硬要求） */
  private markReconnectCancelled(id: string): void {
    const st = this.reconnects.get(id);
    if (!st) return;
    st.cancelled = true;
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    st.phase = 'cancelled';
    this.notify();
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
    let dropped = false;
    if (failure === 'transport' && !session.closing && this.sessions.get(serverId) === session) {
      session.state = 'error';
      dropped = true;
    }
    this.notify();
    // 僵而不退（调用超时没等到回应）⇒ **掉线了** ⇒ 也许该自动重连
    if (dropped) this.noteDrop(serverId, session);
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
    // 进程真没了 ⇒ **掉线了** ⇒ 也许该自动重连（白名单 / 上限 / 退避都在那一侧把关）
    this.noteDrop(id, session);
  }
}
