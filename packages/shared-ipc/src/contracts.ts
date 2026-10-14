import { z } from 'zod';
import {
  SCHEDULE_JITTER_WINDOW_MS,
  SCHEDULE_NAME_MAX_CHARS,
  SCHEDULE_PROMPT_MAX_CHARS,
  SCHEDULE_RULE_MAX_CHARS,
  TOOL_OUTPUT_TAIL_CHARS,
} from './limits';
import { CHAT_IMAGE_MAX_PER_MESSAGE, chatImageInputSchema } from './contracts-media';

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
  /**
   * 「打开方式」的**默认预选档**（M10 收尾）。
   *
   * 注意它记住的只是"下拉框默认停在哪一档"，**不是授权** ——
   * `system` / `custom` 每一交都仍要过硬 ask（判档在 main 的 `open-with-gate.ts`）。
   * 渲染层可以写它：被注入的最多是改成一个更麻烦的默认值，改不出一次放行。
   */
  browserOpenWith: z.enum(['internal', 'system', 'custom']).default('internal'),
  /**
   * 高危清单：命中即**硬 ask**（任何「总是允许」都压不掉）。
   *
   * 面向用户的"这个工具永远问我"请用权限规则里的 `ask`（同样是硬 ask）；
   * 这里是**引擎级兜底**，默认空 —— 由用户直接改配置文件设置，
   * **不经渲染层写入**（安全相关字段不接受界面写入，见 CONFIG_SET 的白名单）。
   */
  alwaysAskTools: z.array(z.string()).default([]),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;

export const defaultAppConfig = (): AppConfig => ({
  theme: 'dark',
  workspace: null,
  appearance: { packId: 'default-dark', pack: null },
  permissionMode: 'default',
  browserOpenWith: 'internal',
  alwaysAskTools: [],
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
  /**
   * 长命令的**实时输出**（R8.7 · M4 收尾其三）。
   *
   * `tail` 是"截至此刻的尾部快照"，不是增量片段 —— 界面只做一次替换。
   * 这么做换来两件实事：① 切走页签期间错过的块不会真丢（回来仍是最新那一份），
   * ② 不需要终端那套 `seq` 去重（少一个机制就少一种错法）。
   * `callId` 必填：一次回答里模型可以连着调好几个工具，不带来源的输出会串到别的气泡上（T5 同形）。
   */
  z.object({
    type: z.literal('tool_output'),
    sessionId: z.string(),
    callId: z.string(),
    name: z.string(),
    tail: z.string().max(TOOL_OUTPUT_TAIL_CHARS),
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
    reason: z.enum(['stop', 'length', 'content_filter', 'aborted', 'error', 'tool_calls']),
    /**
     * 本轮没能写进磁盘历史时的一句话（R25：flush 失败不再只进 main 控制台）——
     * null = 一切正常；渲染层看到它就把话说出来（"重启后这一段会消失"）。
     */
    notice: z.string().nullable().default(null),
  }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

/**
 * 发一条消息的**入参**（T30）。此前只有出参，入参是主进程里一句句 `typeof` 手写校验，
 * `text` / `connectionId` / `sessionId` **都没有长度上限** —— 一次超长粘贴会原样过 IPC、
 * 原样送给 provider。同族字段其实都有上限（历史查询的 `sessionId ≤ 64`、连接那组的 64/300/128/500），
 * 所以这是**漏了一处**而不是全局口径。
 *
 * 上限定这么几个数的理由：文本 20 万字符 —— **这个数是量着产品自己的用例定的**：6b 的压缩阈值场景就会发一条 66000 字的消息来跨过阈值，上限必须明显高于它；20 万既容得下「粘一大段」，又仍是有限的上界；
 * 会话 id 与其他通道同口径 64；连接 id 128（内部 id 的既有量级）。
 * **超限一律拒绝并把上限写进理由** —— 截断是静默改用户输入，本仓不做。
 * 两条既有文案（"请先选择一个连接" / "消息不能为空"）原样搬进来，别让界面上的话变样。
 */
export const chatSendSchema = z
  .object({
    connectionId: z.string().min(1, '请先选择一个连接').max(128, '连接标识过长（上限 128）'),
    text: z.string().max(200_000, '消息过长（上限 20 万字符；更长的内容请放进文件，用文件工具读）'),
    sessionId: z.string().max(64, '会话标识过长（上限 64）').optional(),
    /**
     * 随本条消息发出的图片（M11 批一）：已过主进程准入（魔数 / 5MB / 剥元数据），
     * 发给模型时拼成 content parts；**不落盘**（报备批复 B）。
     */
    images: z
      .array(chatImageInputSchema)
      .max(CHAT_IMAGE_MAX_PER_MESSAGE, '一条消息最多 4 张图片')
      .optional(),
  })
  // 文字可以为空 —— **只有带着图片的时候**（纯图消息）；两边都空依旧是"消息不能为空"
  .refine((v) => v.text.trim() !== '' || (v.images?.length ?? 0) > 0, { message: '消息不能为空' });
export type ChatSendPayload = z.infer<typeof chatSendSchema>;

export const chatSendResultSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  accepted: z.boolean(),
  /**
   * 这一轮"能继续，但有件事该知道"的提示；null = 一切如常。
   * 目前只有一个来源：**磁盘上的历史没装回来**（外部审查 T6④）。
   * 用 `nullable()` 而不是 optional —— 少传一格和"确实没有提示"必须是两件事。
   */
  warning: z.string().nullable(),
});
export type ChatSendResult = z.infer<typeof chatSendResultSchema>;

/** 会话历史里的一条消息（渲染层回显用）。`tool` 也要能回显：工具轨迹是历史的一部分 */
export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  /**
   * 这条消息带着几张图片（M11 批一）。图片**不落盘**（报备批复 B），
   * 这个数字是重启后唯一的痕迹 —— 界面据此显示「图片未保留 ×N」，
   * 而不是让带图的消息看起来和纯文字一模一样。
   */
  imageCount: z.number().int().positive().optional(),
});
export type ChatMessageView = z.infer<typeof chatMessageSchema>;

/**
 * 分页读历史（6a）。`before` 是"取到第几条为止"的下标，缺省取最新一页；
 * `hasMore` 返回还剩多少条 —— 界面据此说"显示更早的 N 条"，而不是自己数数组长度猜。
 */
export const chatHistoryQuerySchema = z
  .object({
    sessionId: z.string().min(1).max(64),
    limit: z.number().int().positive().max(400).optional(),
    before: z.number().int().min(0).optional(),
  })
  .strict();
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;

export const chatHistoryPageSchema = z.object({
  messages: z.array(chatMessageSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.number().int().nonnegative(),
});
export type ChatHistoryPage = z.infer<typeof chatHistoryPageSchema>;

/** 会话清单一行（磁盘事实；title 是首条用户消息的截断，不含全文） */
export const chatSessionMetaSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  messageCount: z.number().int().nonnegative(),
  /** 6b 才写；6a 恒为 0，字段先立住免得下次改数据格式 */
  compactedThrough: z.number().int().nonnegative(),
});
export type ChatSessionMeta = z.infer<typeof chatSessionMetaSchema>;

/* ------------------------------------------------------------------ *
 * 6b：会话压缩与「结束记要点」
 *
 * 三条约定写在类型上，而不是散在注释里：
 * - **失败与"没有内容"都要能区分**：`ok` 是唯一的判定字段，`error` 空串表示"没出错"，
 *   这样渲染层不需要靠"summary 是不是空"去猜失败原因（猜错就会把失败显示成成功）；
 * - 所有对象 `.strict()`：跨进程的载荷多一个字段就该被发现，而不是被无声吞掉；
 * - 摘要与要点的正文字数上限在纯函数里已截过，这里只兜住异常大的输入。
 * ------------------------------------------------------------------ */

/** 压缩状态：界面据此决定要不要提示，**主进程自己不因阈值动手** */
export const compactStatusSchema = z
  .object({
    shouldPrompt: z.boolean(),
    reason: z.string(),
    compactedThrough: z.number().int().nonnegative(),
    rounds: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    /** 未压缩部分的消息条数 */
    messages: z.number().int().nonnegative(),
    totalMessages: z.number().int().nonnegative(),
    /** 这一版摘要落盘的时间（ISO 串）；'' = 还没压缩过。必填：漏了要在 preload 就炸，别静默少一块标识 */
    summaryStoredAt: z.string(),
  })
  .strict();
export type CompactStatusView = z.infer<typeof compactStatusSchema>;

export const compactPreviewResultSchema = z
  .object({
    ok: z.boolean(),
    summary: z.string().max(4_000),
    truncated: z.boolean(),
    /** 存下去之后水印会推进到第几条（落盘行号） */
    willCover: z.number().int().nonnegative(),
    error: z.string(),
  })
  .strict();
export type CompactPreviewResult = z.infer<typeof compactPreviewResultSchema>;

export const compactApplySchema = z
  .object({ sessionId: z.string().min(1), summary: z.string().max(4_000) })
  .strict();
export const compactApplyResultSchema = z
  .object({
    ok: z.boolean(),
    compactedThrough: z.number().int().nonnegative(),
    error: z.string(),
  })
  .strict();
export type CompactApplyResult = z.infer<typeof compactApplyResultSchema>;

/** 一笔"这个会话结束了还没记要点"的账 */
export const pendingNoteItemSchema = z
  .object({
    sessionId: z.string().min(1),
    title: z.string(),
    markedAt: z.string(),
  })
  .strict();
export type PendingNoteItem = z.infer<typeof pendingNoteItemSchema>;

export const pendingNotesViewSchema = z
  .object({
    items: z.array(pendingNoteItemSchema),
    neverAsk: z.boolean(),
  })
  .strict();
export type PendingNotesView = z.infer<typeof pendingNotesViewSchema>;

/**
 * 补问预览只要会话 id：用哪条连接由主进程按会话自己的记录决定（批复⑤），
 * 渲染层连"花谁的钱写这份摘要"都说了不算 —— 它选的可能是另一条连接。
 */
export const pendingPreviewSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const pendingPreviewResultSchema = z
  .object({ ok: z.boolean(), text: z.string().max(4_000), error: z.string() })
  .strict();
export type PendingPreviewResult = z.infer<typeof pendingPreviewResultSchema>;

export const pendingResolveSchema = z
  .object({
    sessionId: z.string().min(1),
    action: z.enum(['remember', 'skip', 'never']),
    text: z.string().max(4_000),
    /** 长期记忆写在选定工作区下；没选就是 null，不能猜 */
    workspaceRoot: z.string().nullable(),
  })
  .strict();
export const pendingResolveResultSchema = z.object({ ok: z.boolean(), error: z.string() }).strict();
export type PendingResolveResult = z.infer<typeof pendingResolveResultSchema>;

/* ------------------------------------------------------------------ *
 * M9：无限画布的通道载荷
 *
 * 三条约定：`.strict()`（跨进程多一个字段就该被发现）；失败与"没有内容"分得开
 * （`ok` 唯一判定、`error` 空串表示没出错）；**图里只有 connectionId**（密钥不进可分享文件）。
 * ------------------------------------------------------------------ */

export const canvasListItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** 首节点的一句话，给列表当名字用（截断，不存全文） */
    name: z.string(),
    nodeCount: z.number().int().nonnegative(),
    updatedAt: z.string(),
  })
  .strict();
export type CanvasListItem = z.infer<typeof canvasListItemSchema>;

export const canvasListResultSchema = z.object({ items: z.array(canvasListItemSchema) }).strict();
export type CanvasListResult = z.infer<typeof canvasListResultSchema>;

export const canvasLoadQuerySchema = z.object({ id: z.string().min(1).max(64) }).strict();

export const canvasLoadResultSchema = z
  .object({
    ok: z.boolean(),
    /** 读不到（不存在 / 版本更新 / 形状不合法）时为 null */
    graph: z.unknown().nullable(),
    error: z.string(),
  })
  .strict();
export type CanvasLoadResult = z.infer<typeof canvasLoadResultSchema>;

export const canvasSaveSchema = z
  .object({
    id: z.string().min(1).max(64),
    graph: z.unknown(),
  })
  .strict();
export const canvasSaveResultSchema = z
  .object({ ok: z.boolean(), error: z.string(), /** 校验没过时逐条列出来给人看 */ problems: z.array(z.string()) })
  .strict();
export type CanvasSaveResult = z.infer<typeof canvasSaveResultSchema>;

export const canvasRunSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** B2 局部重跑：从这个节点起（该节点 + 全部下游）；缺省 = 整图 */
    fromNodeId: z.string().min(1).max(64).optional(),
  })
  .strict();
export const canvasRunResultSchema = z
  .object({
    ok: z.boolean(),
    reason: z.enum(['done', 'failed', 'cancelled']).nullable(),
    error: z.string(),
    /** 逐步记录（成功时就是"真的跑了几步"的证据） */
    steps: z.array(z.string()),
    /**
     * B3：本次执行里**被跳过**（未选分支及下游）的节点数。
     * 必填不是可选：界面那句"几个执行、几个被跳过"拿它说话 ——
     * 漏传会让"跑完了（N 个节点）"把没跑的也算进去（声称比事实多，本项目头号禁区）。
     */
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export type CanvasRunResult = z.infer<typeof canvasRunResultSchema>;

/** main → renderer 的节点事件：**归属判别**（graphId + nodeId）是必填，不许省略 */
export const canvasEventSchema = z
  .object({
    graphId: z.string().min(1),
    nodeId: z.string().min(1),
    status: z.enum(['pending', 'running', 'ok', 'failed', 'denied', 'cancelled', 'skipped']),
    step: z.number().int().nonnegative(),
    note: z.string(),
  })
  .strict();
export type CanvasEventPayload = z.infer<typeof canvasEventSchema>;

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
  /**
   * 这个询问**能不能**被"本次会话总是允许"压掉（来自 `GateDecision.bypassable`）。
   *
   * 为什么要把引擎侧的档位一路带到按钮上（外部审查 T19）：此前弹窗对**所有** ask 都渲染
   * 「本次会话总是允许」，而引擎只在软 ask 上记录这个决定 —— 硬 ask（执行类 / 敏感路径 /
   * 高危清单 / 钩子配置）上点它只兑现"这一次"。按钮承诺了引擎做不到的事，
   * 用户以为以后不问了、实际下次照弹：这不是无害的措辞问题，是**静默失败的镜像形态**。
   * 想减少打扰的正确路径仍然是显式的 allow 规则或 acceptEdits 模式 —— 可查看、可删除。
   */
  bypassable: z.boolean(),
});
export type PermissionRequestPayload = z.infer<typeof permissionRequestSchema>;

/** 主进程侧审批请求结束的通知（按 id 精确关闭对应弹窗，见 `IPC.PERMISSION_EXPIRED`） */
export const permissionExpiredSchema = z.object({
  id: z.string(),
  reason: z.enum(['timeout', 'window-closed', 'cancelled']),
});
export type PermissionExpiredPayload = z.infer<typeof permissionExpiredSchema>;

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
  z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    /**
     * `true` = **接回**了本工作区已有的会话（没起新进程，因此也没再要一次审批）。
     * 渲染层靠它决定要不要显示"已连接"以外的说明，不许省：
     * 把它当常量 false 写死，"点启动其实是接回"这件事就从界面上消失了（T23 的可见性要求）。
     */
    adopted: z.boolean(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TerminalStartResultPayload = z.infer<typeof terminalStartResultSchema>;

/**
 * 查询"这个工作区现在有没有活着的终端会话"（T23）。
 *
 * 页签切走时面板被卸载，但会话在主进程里继续跑 —— 重新挂载时必须先问一句，
 * 否则会走到"启动"上去，而每次都启动正是一个会话变成两个 PTY 的起点。
 */
export const terminalStatusSchema = z.object({ workspaceRoot: z.string().min(1).max(1000) });

export const terminalStatusResultSchema = z.object({
  /** 该工作区当前仍在跑的会话；没有则为 null */
  session: z
    .object({
      sessionId: z.string(),
      /** 切走期间累积的输出尾部（有界，见 `TERMINAL_LIMITS.maxTailChars`） */
      tail: z.string(),
      /** 尾部对应到第几批输出：渲染层用它过滤已经包含在 tail 里的事件，避免重复显示 */
      seq: z.number().int().nonnegative(),
    })
    .nullable(),
  /** 该工作区**上一个**会话的退出信息（进程在自己看不见的时候退出了，回来要讲明白） */
  exited: z
    .object({
      exitCode: z.number().int(),
      /** 主进程用 `describeExitNotice` 生成的说明文本（渲染层不许引 agent-core，所以在这里给） */
      notice: z.string(),
    })
    .nullable(),
  liveCount: z.number().int().nonnegative(),
  maxSessions: z.number().int().positive(),
});
export type TerminalStatusPayload = z.infer<typeof terminalStatusResultSchema>;

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
    /**
     * 这批输出在主进程侧的序号（同一批切成的多个块共用一个号）。
     * 为什么要：重新挂载时"取尾部"与"开始订阅"之间必然有一段间隙，
     * 间隙里到达的块既在 tail 里又会被订阅收到 —— 没有这个号就只能二选一地重复或丢。
     */
    seq: z.number().int().nonnegative(),
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
  /**
   * 命令前缀（按字面匹配命令行的开头）。
   * 长度上限必须与 `agent-core/permissions/rules.ts` 的 MAX_ARG_PREFIX_LENGTH 同数 ——
   * 两边不一致会分成两种坏结果：界面能填进去但引擎拒收，或引擎放行了一段界面根本存不下的文本。
   * 见 `rule-wire-consistency.test.ts` 的一致性锁。
   */
  argPrefix: z.string().max(200).optional(),
});
export type PermissionRuleInput = z.infer<typeof permissionRuleInputSchema>;

export const permissionRuleViewSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  action: permissionRuleActionSchema,
  /**
   * `.default(null)` 不是风格问题（M4 收尾实测）：存储里"没填备注"是**属性缺失或 undefined**，
   * 而 `.nullable()` 单独存在时**不接受 undefined** —— 于是一条不带备注的规则会让
   * 整个列表 IPC 抛错，权限页从此打不开（新增时也会报错，规则却已经落盘）。
   * 界面拿到的一直是 `string | null`，类型没变，只是不再把"没填"判成非法。
   */
  note: z.string().nullable().default(null),
  /** 命令前缀：与 note 同一个道理，没填就是 null，不是"非法" */
  argPrefix: z.string().nullable().default(null),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PermissionRuleView = z.infer<typeof permissionRuleViewSchema>;

/**
 * 权限规则表的**读入健康度**（T37 的界面一半 · R23）：
 * 规则文件读坏了不许静默当成"没有规则"—— 界面据此如实显示"来源"与"发生过降级"。
 */
export const permissionRulesHealthSchema = z.object({
  source: z.enum(['primary', 'backup', 'default']),
  recovered: z.boolean(),
});
export type PermissionRulesHealth = z.infer<typeof permissionRulesHealthSchema>;

/* ------------------------------------------------------------------ *
 * 执行审计（M4 收尾 · 其二）
 * ------------------------------------------------------------------ */

/**
 * 参数摘要的线上形状。
 *
 * **这里没有"值"这一格** —— 审计的落盘形态本来就是"键名 + 长度 + 指纹 + 路径 + 命令（已剔密）"，
 * 契约照着它定义，渲染层就结构上拿不到工具入参原文（拿不到的东西不需要靠纪律去保护）。
 */
export const auditArgSummarySchema = z.object({
  keys: z.array(z.string()),
  lengths: z.record(z.string(), z.number()),
  digests: z.record(z.string(), z.string()),
  paths: z.array(z.string()),
  command: z.string().optional(),
  redacted: z.array(z.string()),
});
export type AuditArgSummary = z.infer<typeof auditArgSummarySchema>;

export const auditEntrySchema = z.object({
  ts: z.string(),
  sessionId: z.string(),
  subject: z.string(),
  kind: z.enum(['read', 'write', 'exec', 'gate']),
  outcome: z.enum(['allow', 'ask', 'deny']),
  asked: z.boolean(),
  /** 这件事做没做成（false = 没做：被拒、被规则挡、超时都算） */
  executed: z.boolean(),
  reason: z.string(),
  answer: z.enum(['allow_once', 'allow_always', 'deny', 'timeout', 'expired', 'edit']).optional(),
  bypassable: z.boolean().optional(),
  durationMs: z.number().optional(),
  rules: z
    .object({
      source: z.enum(['primary', 'backup', 'default']),
      count: z.number(),
      /** 规则文件是否走了回退档（true = 当时的 deny/ask 规则可能压根没生效，见 T37） */
      degraded: z.boolean(),
    })
    .optional(),
  args: auditArgSummarySchema,
});
export type AuditEntryView = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  records: z.array(auditEntrySchema),
  total: z.number(),
  unparsed: z.number(),
  dropped: z.number(),
  /** 一句话的实话（上限、残缺末行、写失败）；没有异常时是空串 */
  notice: z.string(),
  file: z.string(),
  workspaceRoot: z.string(),
});
export type AuditPageView = z.infer<typeof auditPageSchema>;

export const auditExportResultSchema = z.union([
  z.object({ ok: z.literal(true), lines: z.number(), file: z.string() }),
  z.object({ ok: z.literal(false), cancelled: z.boolean(), error: z.string() }),
]);
export type AuditExportResult = z.infer<typeof auditExportResultSchema>;

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

/* ------------------------------------------------------------------ *
 * 内置浏览器（M10 · 轨道扩容计划 1）
 *
 * 与 MCP 同样的理由在这里**独立定义形状**，不从 @jujia/agent-core 引类型：
 * 渲染层绝不引 agent-core（它带 node 内置依赖，进了浏览器包会直接让构建失败）。
 * 策略本体（`decideNavigation` / `decideWindowOpen`）是 agent-core 里的纯函数，
 * 由主进程调用；契约层只描述跨进程的数据形状与"拒绝理由"的载体。
 * ------------------------------------------------------------------ */

/** 占位区位置（CSS 像素、相对渲染层视口）；上限是为了挡住畸形输入而不是限制功能 */
export const browserBoundsSchema = z.object({
  x: z.number().int().min(0).max(20000),
  y: z.number().int().min(0).max(20000),
  width: z.number().int().min(0).max(20000),
  height: z.number().int().min(0).max(20000),
});
export type BrowserBoundsPayload = z.infer<typeof browserBoundsSchema>;

export const browserStateSchema = z.object({
  /** 是否已有受控视图 */
  open: z.boolean(),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /** 是否本机地址（界面据此标"本地服务"） */
  loopback: z.boolean(),
  /** 最近一次被策略拒绝的导航与被拒理由；null = 没有。拒绝必须可见 */
  blocked: z.object({ url: z.string(), reason: z.string() }).nullable(),
});
export type BrowserState = z.infer<typeof browserStateSchema>;

/**
 * 读正文的结果：超限截断并如实标注，绝不静默截断。
 *
 * （旁边曾有一条 `browserNavResultSchema`：`browser:open` / `browser:navigate` 两条通道的返回形状。
 * 三档打开方式落地后那两条通道并进了 `browser:open-with`，那个形状**只剩主进程内部用**，
 * 于是按"不留没人引用的契约"删掉 —— 跨进程返回统一用下面的 `browserOpenWithResultSchema`。）
 */
export const browserTextResultSchema = z.union([
  z.object({ ok: z.literal(true), origin: z.string(), text: z.string(), truncated: z.boolean() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type BrowserTextResult = z.infer<typeof browserTextResultSchema>;

/* ------------------------------------------------------------------ *
 * 「打开方式」三档（M10 收尾 · 轨道扩容计划 1 第 3 步）
 *
 * 目标档位与主进程 `open-with-gate.ts` 的清单**必须一一对应**：
 * 这里多出或漏掉一档，判档那边就会"未知目标直接抛"，接线锁也会红。
 * 网址长度上限 2048 —— 外部程序同样不该被拿来搬运大数据（原先 `browser:open` 那条也是这个上限）。
 * ------------------------------------------------------------------ */

export const browserOpenTargetSchema = z.enum(['internal', 'system', 'custom']);
export type BrowserOpenTarget = z.infer<typeof browserOpenTargetSchema>;

/** 一次"换地方打开"的请求 */
export const browserOpenWithSchema = z
  .object({ url: z.string().min(1).max(2048), target: browserOpenTargetSchema })
  .strict();
export type BrowserOpenWithPayload = z.infer<typeof browserOpenWithSchema>;

/**
 * 打开方式的结果。刻意用**一个对象形状**而不是 union：
 * 界面只有一个"打开"按钮、三种目标，返回形状统一才好写（不用先判断该按哪种结果解析）。
 *
 * - `asked` = 这次**是否真的过了人手**（内置档永远 false）；
 * - `decision` 让人看得见决定来源（`policy:allow` / `allow_once` / `allow_always` / `deny` / `timeout`）；
 * - `state` 只有内置档会带回视图状态（交给外部程序时没有视图可报）；
 * - `error` 是给用户读的理由，不润色成"打开失败"。
 */
export const browserOpenWithResultSchema = z.object({
  ok: z.boolean(),
  target: browserOpenTargetSchema,
  asked: z.boolean(),
  decision: z.string().nullable(),
  state: browserStateSchema.nullable(),
  error: z.string().nullable(),
});
export type BrowserOpenWithResult = z.infer<typeof browserOpenWithResultSchema>;

/**
 * 自选程序路径的写入请求：**只允许清空**。
 *
 * 设为 `strict()` 且不接 `path` 字段，是刻意的：路径只能由主进程的原生文件对话框选定
 * （见 `BROWSER_EXE_PICK`）。若界面能直接填一个路径进来，"选程序"这一步的授权
 * 就从"用户在本机挑了一个文件"退化成"渲染层说了算"。
 */
export const browserExeClearSchema = z.object({ path: z.null() }).strict();
export type BrowserExeClearPayload = z.infer<typeof browserExeClearSchema>;

/** 当前生效的自选程序路径（null = 还没选）；拒绝理由必须可读 */
export const browserExeStateSchema = z.object({
  path: z.string().nullable(),
  /** 这个路径现在还能不能用（文件被删/移走时为 false，界面要如实标出来） */
  usable: z.boolean(),
});
export type BrowserExeState = z.infer<typeof browserExeStateSchema>;

/**
 * 文件对话框 / 清除操作的结果。`path` 是**操作之后当前生效**的路径
 * （取消选择、或被校验拒绝时也要如实带回原值，不能让界面以为变了）。
 */
export const browserExePickResultSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string().nullable(), message: z.string() }),
  z.object({ ok: z.literal(false), path: z.string().nullable(), error: z.string() }),
]);
export type BrowserExePickResult = z.infer<typeof browserExePickResultSchema>;

/* ------------------------------------------------------------------ *
 * 7. git 模块（M8 接线）
 *
 * 与浏览器同样的理由在这里**独立定义形状**，不从 @jujia/agent-core 引类型
 * （渲染层引它会把它带进浏览器包里直接构建失败）。
 * 形状与 `agent-core/src/git/git.ts` 的导出类型一一对应，
 * 由 `git-wiring.test.ts` 交叉核对：**两边只要有一边漂移，`.parse` 立刻抛**。
 * ------------------------------------------------------------------ */

/** 一次操作涉及的路径清单。上限 200：批量暂存够用，同时挡住"拿路径数组搬运大数据" */
export const gitPathsSchema = z.object({
  paths: z.array(z.string().min(1).max(1000)).min(1).max(200),
});
export type GitPathsPayload = z.infer<typeof gitPathsSchema>;

/** 提交信息：非空且不超上限（agent-core 里也是 ≤2000，两边同口径） */
export const gitCommitSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type GitCommitPayload = z.infer<typeof gitCommitSchema>;

/**
 * 推送（M8 收口）：**只有"远端名 + 可选分支"两个字段**，刻意不给 refspec、不给 force、不给任意参数。
 * 长度上限与 `agent-core` 的 SAFE_REMOTE / SAFE_BRANCH 对齐 —— 契约先把形状收窄，
 * 服务层再按字符集判（两层都做，是因为这活儿的失败模式是"越界的那一次静默成功"）。
 */
export const gitPushSchema = z.object({
  remote: z.string().min(1).max(64),
  /** 省略或 null = 推 `HEAD`（当前分支）；我们不替用户猜分支名 */
  branch: z.string().min(1).max(128).nullable().optional(),
});
export type GitPushPayload = z.infer<typeof gitPushSchema>;

/** diff 看的是暂存区还是工作区 */
export const gitDiffSchema = z.object({
  staged: z.boolean().optional(),
  /**
   * `summary`（默认）= 关键行摘录；`patch` = 逐行原文，供 IDE 的 diff 视图。
   * 默认值保持 summary：既有调用点与断言一个字不用改。
   */
  mode: z.enum(['summary', 'patch']).optional(),
  /** 只看某个文件（工作区相对路径）；不传=全部改动 */
  path: z.string().min(1).max(1000).optional(),
});
export type GitDiffPayload = z.infer<typeof gitDiffSchema>;

export const gitLogSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
});
export type GitLogPayload = z.infer<typeof gitLogSchema>;

export const gitStatusEntrySchema = z.object({
  path: z.string(),
  /** porcelain 的两列状态码原文（如 `M `、`??`、`A `） */
  code: z.string(),
  /** 给人看的中文标记（新增 / 修改 / 删除 / 未跟踪…） */
  label: z.string(),
});
export type GitStatusEntryView = z.infer<typeof gitStatusEntrySchema>;

export const gitStatusSchema = z.object({
  isRepo: z.boolean(),
  branch: z.string().nullable(),
  entries: z.array(gitStatusEntrySchema),
  /** 超过上限时如实标注，不假装是全部 */
  truncated: z.boolean(),
});
export type GitStatusView = z.infer<typeof gitStatusSchema>;

export const gitDiffFileSchema = z.object({
  path: z.string(),
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  /** 锁文件 / 构建产物 / min.js 之类噪音：界面默认折叠，但**不隐藏** */
  noise: z.boolean(),
  highlights: z.array(z.string()),
  truncated: z.boolean(),
});
export type GitDiffFileView = z.infer<typeof gitDiffFileSchema>;

export const gitDiffSummarySchema = z.object({
  files: z.array(gitDiffFileSchema),
  totalAdded: z.number().int().min(0),
  totalRemoved: z.number().int().min(0),
  noiseFiles: z.number().int().min(0),
  note: z.string().nullable(),
});
export type GitDiffSummaryView = z.infer<typeof gitDiffSummarySchema>;

/**
 * 写操作与"被权限门拦下"的统一结果。
 * `asked` 说明这次**真的过了人手**（而不是静默放行）；被拒时 `error` 必带可读理由。
 */
export const gitActionResultSchema = z.object({
  ok: z.boolean(),
  data: z.string().nullable(),
  error: z.string().nullable(),
  asked: z.boolean(),
  decision: z.string().nullable(),
});
export type GitActionResultView = z.infer<typeof gitActionResultSchema>;

/** 三条只读查询各自的返回形状：失败也带可读理由，绝不让界面只显示"未知错误" */
export const gitStatusResultSchema = z.union([
  z.object({ ok: z.literal(true), data: gitStatusSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type GitStatusResult = z.infer<typeof gitStatusResultSchema>;

/** patch 模式下单个文件的逐行原文（已按行数上限截断，截断必须如实标注） */
export const gitDiffPatchSchema = z.object({
  path: z.string(),
  text: z.string(),
  lines: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const gitDiffResultSchema = z.union([
  // `mode` 在摘要分支上是**可选**的：老代码构造的两个字段也照常解析（向后兼容不是口惠）
  z.object({ ok: z.literal(true), mode: z.literal('summary').optional(), data: gitDiffSummarySchema }),
  z.object({ ok: z.literal(true), mode: z.literal('patch'), data: z.array(gitDiffPatchSchema) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type GitDiffResult = z.infer<typeof gitDiffResultSchema>;

export const gitLogResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.array(z.string().max(400)) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type GitLogResult = z.infer<typeof gitLogResultSchema>;

/* ------------------------------------------------------------------ *
 * M7 · R9：定时任务
 *
 * 三条约定写在这里，不是散在实现里：
 * - **账本上没有"免审批"这一格**。`autoApprove` / `alwaysAllow` / `skipPermission`
 *   这类键在保存时就被拒（不是"存着不用"），到点触发照走同一扇权限门 ——
 *   停牌①的口径：不自行开常驻放行的口子。
 * - **`.strict()`**：载荷多一个字段就该被发现。上面那条"拒收未知键"正是靠它兜底。
 * - **`nextDueAt` 由主进程算**（`scheduleViewSchema`）：界面自己算一遍就是第二套算式，
 *   显示 09:00 而实际 09:40 才跑，是那种没人报 bug、只会再也不信这功能的错。
 * ------------------------------------------------------------------ */

export const scheduledTaskSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(SCHEDULE_NAME_MAX_CHARS),
    /** RRULE 子集原文；语义由 `agent-core/schedule/rrule` 判，这里只管形状 */
    rule: z.string().min(1).max(SCHEDULE_RULE_MAX_CHARS),
    /** 到点交给模型的那句话（不执行任何命令 —— 命令由模型请求、由权限门批） */
    prompt: z.string().min(1).max(SCHEDULE_PROMPT_MAX_CHARS),
    connectionId: z.string().min(1).max(128),
    /** 这条任务最早可能触发的那一刻；改规则不跟着改它 */
    anchorAt: z.string().min(1),
    /** 绑定到哪一个会话（第一次触发才建，之后复用，不每次新灌一条会话） */
    sessionId: z.string().nullable(),
    enabled: z.boolean(),
    /** 按 id 派生并**落盘固定**：重启后换点就会被当成"这一次还没跑过"而重复补跑 */
    jitterMs: z.number().int().nonnegative().max(SCHEDULE_JITTER_WINDOW_MS),
    /** 上一次真触发的时刻 —— 同时是补跑的水位线 */
    lastRunAt: z.string().nullable(),
    /** 上次触发时替用户跳过了多少次（0 = 正常到点，不是补跑） */
    lastSkipped: z.number().int().nonnegative(),
    /** 上次触发的可见失败原因；空串 = 没有。不静默 */
    lastError: z.string(),
  })
  .strict();
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

/** 界面 → 主进程：新增（无 `id`）或修改（带 `id`） */
export const scheduleSaveSchema = z
  .object({
    id: z.string().max(64).nullable(),
    name: z.string(),
    rule: z.string(),
    prompt: z.string(),
    connectionId: z.string(),
  })
  .strict();
export type ScheduleSaveInput = z.infer<typeof scheduleSaveSchema>;

/** 增删改之后一律把整份清单回给界面（界面不乐观改状态 —— 服务端才是事实） */
export const scheduleMutationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), tasks: z.array(scheduledTaskSchema) }),
  z.object({ ok: z.literal(false), error: z.string(), tasks: z.array(scheduledTaskSchema) }),
]);
export type ScheduleMutationResult = z.infer<typeof scheduleMutationResultSchema>;

/** 启停与删除的入参（每个跨进程入参都过契约，不靠 handler 里手写 typeof） */
export const scheduleToggleSchema = z
  .object({ id: z.string().min(1).max(64), enabled: z.boolean() })
  .strict();
export type ScheduleToggleInput = z.infer<typeof scheduleToggleSchema>;

export const scheduleDeleteSchema = z.object({ id: z.string().min(1).max(64) }).strict();
export type ScheduleDeleteInput = z.infer<typeof scheduleDeleteSchema>;

/**
 * 主进程算好的一份视图：任务本体 + 下一次该醒的时刻 + 该说的话。
 * `nextDueAt` 为 null 只有一种原因：规则或锚点坏了，而那时 `note` 一定非空。
 */
export const scheduleViewSchema = z
  .object({
    task: scheduledTaskSchema,
    nextDueAt: z.string().nullable(),
    note: z.string(),
  })
  .strict();
export type ScheduleView = z.infer<typeof scheduleViewSchema>;

export const scheduleListResultSchema = z
  .object({
    views: z.array(scheduleViewSchema),
    /** 清单读不出来时的实话（回落备份、版本不认识…）；空串 = 一切正常 */
    health: z.string(),
  })
  .strict();
export type ScheduleListResult = z.infer<typeof scheduleListResultSchema>;

/** 到点这件事要主动通知界面（界面因此重读清单；不做轮询，轮询是第二个定时器） */
export const scheduleEventSchema = z
  .object({
    taskId: z.string(),
    name: z.string(),
    kind: z.enum(['fired', 'failed', 'invalid-rule']),
    /** 给人看的一句话（含"跳过 N 次"），有上界，不塞正文 */
    note: z.string().max(500),
    at: z.string(),
  })
  .strict();
export type ScheduleEventPayload = z.infer<typeof scheduleEventSchema>;

/* ------------------------------------------------------------------ *
 * M19：轻量 IDE 的 PDF 打开（只读）
 *
 * 两条约定写进类型里：
 * - **失败与"没内容"必须能区分**：`ok` 是唯一判定字段，`error` 空串表示没出错；
 * - `.strict()`：跨进程载荷多一个字段就该被发现，而不是被无声吞掉。
 * ------------------------------------------------------------------ */

export const pdfOpenQuerySchema = z.object({ path: z.string().min(1).max(1000) }).strict();
export type PdfOpenQuery = z.infer<typeof pdfOpenQuerySchema>;

export const pdfOpenResultSchema = z
  .object({
    ok: z.boolean(),
    /** 成功时是文件字节（给渲染层画图用）；失败为 null */
    bytes: z.instanceof(Uint8Array).nullable(),
    /** 实际字节数（失败时为 0）；上限见 `PDF_MAX_BYTES` */
    size: z.number().int().nonnegative(),
    error: z.string(),
  })
  .strict();
export type PdfOpenResult = z.infer<typeof pdfOpenResultSchema>;
