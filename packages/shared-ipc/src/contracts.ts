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
export const appConfigSchema = z.object({
  theme: z.enum(['light', 'dark']),
  workspace: z.string().nullable(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const defaultAppConfig = (): AppConfig => ({ theme: 'dark', workspace: null });

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
