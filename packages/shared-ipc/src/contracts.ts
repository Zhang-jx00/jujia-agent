import { z } from 'zod';

/** 应用与运行时信息（P0 打通链路用；后续阶段会逐步扩充字段）。 */
export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  /** 当前生效的安全开关，便于渲染层展示与自检 */
  security: z.object({
    contextIsolation: z.boolean(),
    sandbox: z.boolean(),
    nodeIntegration: z.boolean(),
    webSecurity: z.boolean(),
  }),
  /** 数据根目录绝对路径（JuJiaData） */
  dataRoot: z.string(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** 应用配置（Phase 1 先落两个字段，设置页在 W6 扩） */
/**
 * 外观（W23）。
 *
 * 注意纪律：这里**只描述形状**（packId + 一个对象），
 * 真正的安全校验在主进程用 `@jujia/ui-tokens` 的 `validateThemePack()` 做
 * ——受控字段白名单只允许有一处实现，避免两份规则漂移。
 */
export const appearanceSchema = z.object({
  /** 使用的样式包 id（内置或用户导入的） */
  packId: z.string().min(1).max(64),
  /** 样式包完整内容（已通过 validateThemePack 校验后才允许落盘） */
  pack: z.unknown().nullable().default(null),
});

/** 权限模式（W5a 定义，**W10g 起才真正接入执行路径**——此前是死代码） */
export const permissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const appConfigSchema = z.object({
  theme: z.enum(['light', 'dark']),
  workspace: z.string().nullable(),
  appearance: appearanceSchema.default({ packId: 'default-dark', pack: null }),
  /** 会话级权限模式；规则表是常设配置，二者关系见 agent-core 的 decideGate */
  permissionMode: permissionModeSchema.default('default'),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;

export const defaultAppConfig = (): AppConfig => ({
  theme: 'dark',
  workspace: null,
  appearance: { packId: 'default-dark', pack: null },
  permissionMode: 'default',
});

/** 配置读取结果：带上「来源」与「是否从损坏中恢复」，供 UI 如实提示用户 */
export const configSnapshotSchema = z.object({
  config: appConfigSchema,
  version: z.number().int().nonnegative(),
  source: z.enum(['primary', 'backup', 'default']),
  recovered: z.boolean(),
  /**
   * 本次会话中发生过的恢复来源（没有则为 null）。
   *
   * 为什么需要它：自愈写入完成后，磁盘上已经是健康的 primary，
   * 单看 `source` 无法再看出「本次启动曾经损坏过」，用户会被静默糊弄过去。
   */
  recoveredFrom: z.enum(['backup', 'default']).nullable().default(null),
  recoveredAt: z.string().nullable().default(null),
});

export type ConfigSnapshot = z.infer<typeof configSnapshotSchema>;

/* ------------------------------------------------------------------ *
 * W2：连接（Connection）与流式对话
 * 纪律：apiKey 永不进入渲染层。渲染层只能看到 hasApiKey / apiKeyHint。
 * ------------------------------------------------------------------ */

/** 协议档位。W2 只实现 OpenAI 兼容；Anthropic 档在 W3+ 补。 */
export const apiFormatSchema = z.enum(['openai-compatible']);
export type ApiFormat = z.infer<typeof apiFormatSchema>;

export const connectionInputSchema = z.object({
  name: z.string().min(1).max(64),
  baseUrl: z.string().min(1).max(300),
  apiFormat: apiFormatSchema,
  model: z.string().min(1).max(128),
  /** 创建时必填；更新时省略表示「不改动已有密钥」 */
  apiKey: z.string().max(500).optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

/** 渲染层可见的连接视图（脱敏） */
export const connectionViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  apiFormat: apiFormatSchema,
  model: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  hasApiKey: z.boolean(),
  /** 仅用于让用户确认「填的是哪一把」，例如 `sk-…c3f9` */
  apiKeyHint: z.string().nullable(),
});
export type ConnectionView = z.infer<typeof connectionViewSchema>;

export const testResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  models: z.array(z.string()).max(200).default([]),
  latencyMs: z.number().int().nonnegative().default(0),
});
export type TestResult = z.infer<typeof testResultSchema>;

/* ---------------------------- 流式事件 ---------------------------- */

export const streamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text_delta'),
    sessionId: z.string(),
    messageId: z.string(),
    seq: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('tool_start'),
    sessionId: z.string(),
    callId: z.string(),
    name: z.string(),
    argumentsText: z.string(),
  }),
  z.object({
    type: z.literal('tool_end'),
    sessionId: z.string(),
    callId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    summary: z.string(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('usage'),
    sessionId: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    sessionId: z.string(),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    sessionId: z.string(),
    reason: z.enum(['stop', 'length', 'aborted', 'error', 'tool_calls']),
  }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

export const chatSendResultSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  accepted: z.boolean(),
});
export type ChatSendResult = z.infer<typeof chatSendResultSchema>;

/** 会话历史里的一条消息（渲染层回显用） */
export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessageView = z.infer<typeof chatMessageSchema>;

/* ------------------------------------------------------------------ *
 * W3：工作区与权限审批
 * ------------------------------------------------------------------ */

export const workspaceInfoSchema = z.object({
  /** 绝对路径；未选择时为 null */
  root: z.string().nullable(),
  /** 是否真实存在且是目录 */
  valid: z.boolean(),
  /** 是否可写（决定写工具能否工作） */
  writable: z.boolean(),
  /** 人类可读的说明（例如「目录不存在」） */
  message: z.string(),
});
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;

/** 权限审批请求（main → renderer） */
export const permissionRequestSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  kind: z.enum(['read', 'write', 'exec']),
  summary: z.string(),
  args: z.unknown(),
  paths: z.array(z.string()),
});
export type PermissionRequestPayload = z.infer<typeof permissionRequestSchema>;

export const permissionDecisionSchema = z.enum([
  'allow_once',
  'allow_always',
  'deny',
  'timeout',
  /** 允许但先改参数（2026 主流框架的四态之一） */
  'edit',
]);
export type PermissionDecisionPayload = z.infer<typeof permissionDecisionSchema>;

/** 工具活动（供 UI 展示工具卡；W3 先落最小字段） */
/** 工具执行结果（W3：直接执行形态，供工作区自检与 M2 验收使用） */
export const toolRunResultSchema = z.object({
  ok: z.boolean(),
  toolName: z.string(),
  /** 回给模型/UI 的文本 */
  content: z.string(),
  durationMs: z.number().int().nonnegative(),
  /** 是否触发了权限询问 */
  asked: z.boolean(),
  decision: permissionDecisionSchema.nullable(),
  /** 涉及的工作区内路径 */
  paths: z.array(z.string()),
});
export type ToolRunResult = z.infer<typeof toolRunResultSchema>;

/* ------------------------------------------------------------------ *
 * W9b：内置终端
 * ------------------------------------------------------------------ */

/** 新建终端的入参：只允许工作区根目录（终端不能开在工作区之外） */
export const terminalStartSchema = z.object({
  workspaceRoot: z.string().min(1).max(1000),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(300).optional(),
});
export type TerminalStartPayload = z.infer<typeof terminalStartSchema>;

export const terminalStartResultSchema = z.union([
  z.object({ ok: z.literal(true), sessionId: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TerminalStartResultPayload = z.infer<typeof terminalStartResultSchema>;

export const terminalInputSchema = z.object({
  sessionId: z.string().min(1),
  /** 输入长度设上限：粘贴超长文本时避免一次打爆 IPC */
  data: z.string().max(64 * 1024),
});

export const terminalResizeSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number(),
  rows: z.number(),
});

export const terminalKillSchema = z.object({ sessionId: z.string().min(1) });

/** main → renderer 的终端事件 */
export const terminalEventSchema = z.union([
  z.object({
    type: z.literal('data'),
    sessionId: z.string(),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal('exit'),
    sessionId: z.string(),
    exitCode: z.number().int(),
  }),
]);
export type TerminalEventPayload = z.infer<typeof terminalEventSchema>;

/* ------------------------------------------------------------------ *
 * MCP（W10e）
 *
 * 为什么这里**独立定义**一份形状，而不是从 @jujia/agent-core 导入类型：
 * 渲染层绝不允许引入 agent-core（它带 node 内置依赖，进了浏览器包会直接让构建失败）。
 * 代价是形状有两处定义，可能漂移 —— 因此主进程在把 agent-core 的结果发出去之前，
 * 会用它下面的 schema 做一次 parse：**漂移会立刻抛错，而不是悄悄传一个字段对不上的对象给 UI**。
 * ------------------------------------------------------------------ */

/** 服务端连接状态。`exited` 与 `error` 要分开：前者是进程死了，后者是握手/启动失败 */
export const mcpStateSchema = z.enum([
  'idle',
  'connecting',
  'awaiting_approval',
  'connected',
  'error',
  'exited',
]);
export type McpState = z.infer<typeof mcpStateSchema>;

export const mcpServerInputSchema = z.object({
  /** 省略表示新增；带上表示更新已存在的那个 */
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(64),
  /** 可执行文件（如 npx）。**含 shell 元字符会被主进程拒绝** */
  command: z.string().min(1).max(300),
  args: z.array(z.string().max(500)).max(50).default([]),
  /**
   * 额外的环境变量。**不要放密钥**（本项目约定密钥不进模型上下文）。
   *
   * 省略 → **不改动现有环境变量**。这不是可有可无的容错：
   * 环境变量的**值从不回传到渲染层**（只回传键名），因此编辑界面拿不到原值，
   * 若强制要求传 env，用户在界面上改个名字就会把值静默清空。
   * 传空对象 `{}` 才是"显式清空"。
   */
  env: z.record(z.string().max(4000)).optional(),
});
export type McpServerInput = z.infer<typeof mcpServerInputSchema>;

export const mcpServerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  /** 只给键名，**绝不带值** —— 避免密钥出现在 UI 与日志里 */
  envKeys: z.array(z.string()),
  state: mcpStateSchema,
  /** 本次连接发现到的工具总数（未连接时为 0） */
  discoveredTools: z.number().int().nonnegative(),
  /** 本次已批准因此**真正可调用**的工具（未批准的不在其中） */
  enabledTools: z.array(z.string()),
  /** 上次失败原因（成功时为 null） */
  lastError: z.string().nullable(),
  /**
   * 这个服务端是谁给的：你自己配的（`user`）还是插件清单里带的（`plugin`）。
   *
   * 界面必须区分：插件带来的服务端**由插件决定**，不能在这里改或删 ——
   * 否则用户改完、插件一更新就被覆盖，还会以为是应用丢了配置。
   */
  source: z.enum(['user', 'plugin']).default('user'),
  /** 来自哪个插件（source=plugin 时非空） */
  pluginName: z.string().nullable().default(null),
  /**
   * 插件清单把它标成 `enabled: false` 时为 true。
   * 仍然列出来（"被插件禁用了"这件事必须可见），但**不允许连接**，连接会给出明确理由。
   */
  disabledByPlugin: z.boolean().default(false),
});
export type McpServerView = z.infer<typeof mcpServerViewSchema>;

/** 给用户看的待批准计划（形状与 agent-core 的 ConnectionApprovalPlan 对齐） */
export const mcpApprovalPlanSchema = z.object({
  serverId: z.string(),
  serverName: z.string(),
  /** **将实际执行的命令**，逐字展示 */
  commandLine: z.string(),
  envKeys: z.array(z.string()),
  toolCount: z.number().int().nonnegative(),
  alwaysAskCount: z.number().int().nonnegative(),
  readOnlyCount: z.number().int().nonnegative(),
  tools: z.array(
    z.object({
      qualifiedName: z.string(),
      rawName: z.string(),
      /** `write` 目前不会出现（MCP 只推断 read/exec），保留以免将来扩展时改契约 */
      kind: z.enum(['read', 'write', 'exec']),
      kindReason: z.string(),
      description: z.string(),
    }),
  ),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  needsExtraAttention: z.boolean(),
});
export type McpApprovalPlan = z.infer<typeof mcpApprovalPlanSchema>;

export const mcpApprovalChoiceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('deny') }),
  z.object({ action: z.literal('approve_all') }),
  z.object({ action: z.literal('approve_partial'), toolNames: z.array(z.string()).max(500) }),
]);
export type McpApprovalChoice = z.infer<typeof mcpApprovalChoiceSchema>;

export const mcpConnectResultSchema = z.union([
  z.object({ ok: z.literal(true), plan: mcpApprovalPlanSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type McpConnectResult = z.infer<typeof mcpConnectResultSchema>;

export const mcpApproveResultSchema = z.object({
  approved: z.boolean(),
  /** 批准后**实际可用**的工具；未批准的会被彻底排除（不是隐藏） */
  enabledTools: z.array(z.string()),
  note: z.string(),
  /** 成功进注册表的模型侧工具名 */
  registered: z.array(z.string()),
  /** 被跳过的工具与**具体原因**（不静默丢弃） */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type McpApproveResult = z.infer<typeof mcpApproveResultSchema>;

/* ------------------------------------------------------------------ *
 * 权限规则表（W5c / M15）
 * ------------------------------------------------------------------ */

export const permissionRuleActionSchema = z.enum(['allow', 'deny', 'ask']);
export type PermissionRuleAction = z.infer<typeof permissionRuleActionSchema>;

/** 新增规则的入参（更深的校验在主进程用 agent-core 的 checkRuleInput 做） */
export const permissionRuleInputSchema = z.object({
  /** 工具名 glob：`*` 不跨路径分隔符、`**` 全匹配、`?` 单字符 */
  pattern: z.string().min(1).max(200),
  action: permissionRuleActionSchema,
  note: z.string().max(200).optional(),
});
export type PermissionRuleInput = z.infer<typeof permissionRuleInputSchema>;

export const permissionRuleViewSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  action: permissionRuleActionSchema,
  note: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PermissionRuleView = z.infer<typeof permissionRuleViewSchema>;

/* ------------------------------------------------------------------ *
 * 生命周期钩子（W5d）
 * ------------------------------------------------------------------ */

/** 界面看到的状态：原始配置 + 校验错误 + 每个事件命中的钩子数（便于一眼看出到底跑不跑） */
export const hooksStateSchema = z.object({
  raw: z.record(z.string(), z.unknown()),
  /** 配置校验错误（逐条；非空时配置**不会**生效，钩子回落为关闭） */
  errors: z.array(z.string()),
  enabled: z.boolean(),
  filePath: z.string(),
  /** 事件名 → 钩子数量 */
  counts: z.record(z.string(), z.number()),
});
export type HooksState = z.infer<typeof hooksStateSchema>;

export const hooksSaveResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()),
  state: hooksStateSchema,
});
export type HooksSaveResult = z.infer<typeof hooksSaveResultSchema>;

/* ------------------------------------------------------------------ *
 * 插件（W11b）
 * ------------------------------------------------------------------ */

export const pluginDiagnosticSchema = z.object({
  plugin: z.string(),
  dir: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
});

export const pluginsStateSchema = z.object({
  summary: z.string(),
  scannedDirs: z.array(z.string()),
  plugins: z.array(
    z.object({
      name: z.string(),
      version: z.string().nullable(),
      description: z.string().nullable(),
      dir: z.string(),
      /** 贡献的技能目录数（**只统计真实存在的**） */
      skillsCount: z.number(),
      commandsCount: z.number(),
      /** 贡献的 MCP 服务端名（本轮只解析、未接入，界面会如实标注） */
      mcpServers: z.array(z.string()),
      diagnostics: z.array(pluginDiagnosticSchema),
    }),
  ),
  diagnostics: z.array(pluginDiagnosticSchema),
});
export type PluginsState = z.infer<typeof pluginsStateSchema>;
