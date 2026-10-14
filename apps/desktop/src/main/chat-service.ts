import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  appendNote,
  assembleSystemPrompt,
  buildCompactPrompt,
  buildNotePrompt,
  buildSummarySection,
  buildTaskResumeSection,
  capSummary,
  createDefaultRegistry,
  decideCompactPrompt,
  loadNotes,
  loadProjectContext,
  measureContext,
  runAgentTurn,
  sessionStart,
  streamChat,
  type ChatMessage,
  type LoopEvent,
  type PermissionMode,
  type PermissionResolver,
  type HookRunner,
  type PermissionRule,
  type ToolRegistry,
  type GateAuditInfo,
  decodeBase64,
  prepareImage,
} from '@jujia/agent-core';
import {
  TOOL_OUTPUT_FLUSH_CHARS,
  TOOL_OUTPUT_QUIET_MS,
  TOOL_OUTPUT_TAIL_CHARS,
  type ChatTaskView,
  type StreamEvent,
} from '@jujia/shared-ipc';
import { resolveConnection } from './connections-store';
import { createToolOutputRelay } from './tool-output-relay';
import { pickHistoryPage } from './history-window';
import { getDataRoot } from './paths';
import { buildContentParts, buildModelHistory, mergeTurnResult, withContentParts } from './model-history';
import { createPendingNotes, shouldAskAgain, type PendingNotes } from './pending-notes';
import { createSessionJournal } from './session-journal';
import type { Logger } from './logger';
import { needsEviction, pickEvictionCandidate } from './session-lru';
import { taskStore } from './task-store';
import {
  createTask,
  describeInterruption,
  finishTask,
  interruptIfRunning,
  markDismissed,
  markResumed,
  resumeBlockReason,
  stepFinished,
  stepStarted,
  type TaskRecord,
} from './task-state';
import {
  createFileSessionStore,
  toStoredMessage,
  type SessionMeta,
  type StoredMessage,
  type SessionStore,
  type StoredRole,
} from './session-store';

/**
 * 基础人格。**注意**：项目指令与长期记忆不写死在这里，而是每次发送时按工作区动态装配
 * （见 memory 模块），这样换工作区就能换上下文，且用户可随时查看/编辑来源文件。
 */
const BASE_PROMPT = '你是俱佳Agent，一个运行在用户 Windows 桌面上的助手。回答简洁、准确，使用中文。';

/**
 * T40（2026-10-09 审计项，2026-10-14 修）：未选工作区的提示。
 * 它**并入系统提示的重拼**（每轮覆盖），绝不逐轮 push 进消息数组 ——
 * 旧写法会让上下文逐轮增长，且用户中途选好工作区后旧的"尚未选择"仍留在历史里自相矛盾。
 */
const NO_WORKSPACE_NOTICE =
  '当前尚未选择工作区，所有文件类工具都不可用。若用户要求读写文件，请提示其先在「概览」页选择工作区。';

/**
 * 单轮内最多允许的模型往返次数（Agent Loop 的熔断上界）。
 * 取 8：足够「读文件 → 改 → 跑测试 → 汇报」这类多步任务，又不至于把余额烧光。
 */
const MAX_TURNS = 8;

export type StreamEmitter = (event: StreamEvent) => void;

interface Session {
  id: string;
  connectionId: string;
  messages: ChatMessage[];
  /** SessionStart 钩子是否已经跑过（只跑一次，避免每轮都注入） */
  startedHookFired: boolean;
  controller: AbortController | null;
  running: boolean;
  /** 会话级「总是允许」白名单（工具名） */
  alwaysAllow: Set<string>;
  /** 最近一次使用时间（用于淘汰最久未用的会话） */
  lastUsedAt: number;
  /** 建会话的时刻（ISO），进元信息 */
  createdAt: string;
  /**
   * 压缩水印：**落盘行号**，不是内存数组下标（6b · 报备 §一，批复②）。
   * 用下标会错：第 0 条是不落盘的 system 提示，重启后两套坐标对不上，
   * 而 `session-journal` 正是按落盘条数记账的。
   */
  compactedThrough: number;
}

const sessions = new Map<string, Session>();

/**
 * 会话上限（轨道回归计划 1 修 M1）。
 *
 * 此前 `sessions` **只增不删**：每开一个新会话就往 Map 里塞一份完整消息历史，
 * 长时间使用（或反复新建会话）内存单调上涨。现在给一个硬上限，
 * 超出时淘汰**最久未使用**的那个 —— 并把它说清楚，而不是悄悄丢。
 */
const MAX_SESSIONS = 20;

/**
 * 会话存储（6a）。**进程级单例 + 懒建**：`getDataRoot()` 要用 electron 的 userData 路径，
 * 在模块加载期调它会让这一层没法被纯单测使用；放到第一次真正要写盘时再取。
 */
let storeRef: SessionStore | null = null;

function store(): SessionStore {
  if (storeRef === null) storeRef = createFileSessionStore();
  return storeRef;
}

/** 测试注入（含传 null 恢复"第一次用时再建"的行为） */
export function __setSessionStoreForTests(injected: SessionStore | null): void {
  storeRef = injected;
}

/** 会进磁盘的部分：system 那条**不存** —— 它是每轮重新装配的产物，存下来只会在模型换版后留下旧副本 */
function persistable(s: Session): Session['messages'] {
  return s.messages.filter((m) => m.role !== 'system');
}

function metaOf(s: Session, messageCount: number): SessionMeta {
  const firstUser = persistable(s).find((m) => m.role === 'user');
  // M11：纯图消息的 content 是空串 —— 直接取会给会话列表留一个空标题（看起来像坏了）
  const firstText = (firstUser?.content ?? '').trim();
  return {
    id: s.id,
    connectionId: s.connectionId,
    title: firstText !== '' ? firstText.slice(0, 40) : '（无标题）',
    createdAt: s.createdAt,
    lastUsedAt: new Date(s.lastUsedAt).toISOString(),
    messageCount,
    compactedThrough: s.compactedThrough,
  };
}

/**
 * 落盘的"追加 + 记账"（T6①②）。计数归这个 journal 所有，不放 `Session` 上 ——
 * 两个地方各记一份账，迟早会有一份不准。
 */
const journal = createSessionJournal({
  append: (id, messages) => store().append(id, messages),
  saveMeta: (meta) => store().saveMeta(meta),
});

/**
 * 失败出口（T47 · 2026-10-14 审计清零批）。
 *
 * 2026-10-09 审计那条"落盘失败只进 console"到本轮才全清：R25 把**活动轮次**的那一条接上了
 * `done.notice`（界面看得见），但模块级函数里还留着六处只写 console ——
 * 而**打包后的 Electron 里 console 不进任何文件**，于是那六处等于"没人知道"。
 * 结构化日志（M12 批一）就在同一个进程里、出口是现成的，缺的只是接过来。
 *
 * 为什么是一个模块级 setter 而不是 `ChatDeps` 一路传：这些失败点（轮末 flush、元信息、
 * 任务记录、起轮补写、摘要读、记忆装配、SessionStart 钩子）都不在 deps 的调用链上，
 * 为一个出口改六处签名的代价比 setter 大，风险却相同。
 */
let persistLogger: Logger | null = null;

/** 由装配根在 `app.whenReady()` 之后调用；不调用 = 退回"只进 console"的旧行为（不假装日志一定在） */
export function setPersistLogger(log: Logger): void {
  persistLogger = log;
}

/** 失败必须说话：console（开发期）+ 结构化日志（打包后唯一能被翻查的地方） */
function fail(scope: string, msg: string, err?: unknown): void {
  console.warn(`[${scope}] ${msg}`, err ?? '');
  // logger 自己"发射后不管"（见 logger.ts 文件头）：记日志失败不许拖垮它要记的这件事
  persistLogger?.warn(scope, msg, err === undefined ? {} : { error: err instanceof Error ? err.message : String(err) });
}

/** ChatMessage → 入库形态（`system` 不落盘由 `persistable` 负责过滤） */
function toStored(m: ChatMessage): StoredMessage {
  return toStoredMessage(m.role as StoredRole, m.content, new Date(), {
    ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
    ...(m.toolCalls !== undefined
      ? { toolCalls: m.toolCalls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })) }
      : {}),
    // M11：图片**字节不落盘**，只记张数（重启后界面据此说"[图片未保留 ×N]"）
    ...(m.imageCount !== undefined ? { imageCount: m.imageCount } : {}),
  });
}

/**
 * 把本轮新增的消息追加落盘。**只追加完整行**，所以进程中途死最多丢最后一条。
 * 失败不静默：console.warn 之外，**消息写失败的原文会返回给调用方**，
 * 由它经 done 事件的 `notice` 递给界面（R25：丢历史是可感知的事实，界面也要看得见）。
 *
 * 两种失败要分开说（T6①）：**消息没写进去**才是"历史丢了"；
 * **元信息没写进去**只是"列表里的条数 / 标题旧了一格"，下一轮不会因此重放消息。
 */
async function flushSession(s: Session): Promise<string | null> {
  const all = persistable(s);
  try {
    const out = await journal.flush(s.id, all.map(toStored), (total) => metaOf(s, total));
    if (out.metaError !== null) {
      fail('chat', `会话 ${s.id.slice(0, 8)} 的消息已落盘，但元信息没写进去（清单条数会旧一格，不会重复追加）`, out.metaError);
    }
    return null;
  } catch (err) {
    fail('chat', `会话 ${s.id.slice(0, 8)} 的历史没写进去`, err);
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * 任务记录落盘（M17 批一）。**写失败不抛穿业务**（一条恢复记录坏了，不该让一次正常对话跟着死），
 * 但如实报出来 —— 丢的是"崩溃恢复"这条线，不是这次对话本身。
 */
async function persistTask(id: string, rec: TaskRecord): Promise<void> {
  try {
    await taskStore().write(id, rec);
  } catch (err) {
    fail('task', `会话 ${id.slice(0, 8)} 的任务记录没写进去（崩溃恢复这条线会缺一段）`, err);
  }
}

/** 淘汰最久未使用的会话；正在运行的不动（避免把用户正在等的对话删掉） */
function evictOldSessions(): void {
  // 一次可能清掉多个（例如把上限调小之后），循环直到不需要淘汰为止
  for (let guard = 0; guard < 1_000; guard += 1) {
    if (!needsEviction(sessions.size, MAX_SESSIONS)) return;
    const victim = pickEvictionCandidate([...sessions.values()], MAX_SESSIONS);
    if (victim === null) return; // 全都在运行 → 暂不淘汰
    const doomed = sessions.get(victim);
    sessions.delete(victim);
    // 6a 起"淘汰 = 从内存卸载"，磁盘上那份还在 —— 运行中的会话由 pickEvictionCandidate 排除在外，
    // 这里再兜一次：真被删掉的这个如果还在写，就把已落盘的部分保住，不动进行中的那一轮
    // 记账要等 flush 跑完再丢：先 forget 会让"下一次 flush 以为盘上是空的"，正好重演出 T6① 那个 bug
    if (doomed !== undefined && !doomed.running) void flushSession(doomed).then(() => journal.forget(doomed.id));
    console.warn(
      `[chat] 会话数达到上限 ${MAX_SESSIONS}，已从内存卸载最久未使用的会话（磁盘上的消息还在；未落盘的部分正在补写，写失败会单独报错）`,
    );
  }
}

/** 仅用于测试 */
export function __resetSessions(): void {
  for (const id of sessions.keys()) journal.forget(id);
  sessions.clear();
}

/** 仅用于测试/诊断：当前驻留的会话数 */
export function __sessionCount(): number {
  return sessions.size;
}

function buildSession(connectionId: string): Session {
  evictOldSessions();
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    connectionId,
    messages: [{ role: 'system', content: BASE_PROMPT }],
    createdAt: now,
    startedHookFired: false,
    controller: null,
    running: false,
    alwaysAllow: new Set<string>(),
    lastUsedAt: Date.now(),
    compactedThrough: 0,
  };
  sessions.set(session.id, session);
  return session;
}

export function getHistory(sessionId: string): ChatMessage[] {
  return sessions.get(sessionId)?.messages ?? [];
}

/** 界面用的会话清单（磁盘事实，不看内存驻留与否） */
export async function listSessions(): Promise<Awaited<ReturnType<SessionStore['list']>>> {
  return store().list();
}

/**
 * 把磁盘上的会话装回内存（重启后续聊的关键一步）。
 * 返回 false 表示已在内存或没有这个会话，调用方按现有路径走即可。
 */
export async function hydrateSession(sessionId: string, connectionId: string): Promise<boolean> {
  if (sessions.has(sessionId)) return false;
  const loaded = await store().load(sessionId);
  const now = new Date().toISOString();
  const session: Session = {
    id: sessionId,
    connectionId,
    // system 那条不落盘，回来时重新装配 —— 每轮发送前本来也会按工作区覆盖它
    messages: [{ role: 'system', content: BASE_PROMPT }],
    createdAt: now,
    startedHookFired: true,
    controller: null,
    running: false,
    alwaysAllow: new Set<string>(),
    lastUsedAt: Date.now(),
    compactedThrough: loaded.compactedThrough,
  };
  for (const m of loaded.messages) {
    session.messages.push({
      role: m.role,
      content: m.content,
      ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
      ...(m.toolCalls !== undefined
        ? { toolCalls: m.toolCalls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })) }
        : {}),
      // M11：只把"带过几张图"带回来（字节本来就没存）；界面据此显示"[图片未保留 ×N]"
      ...(m.imageCount !== undefined ? { imageCount: m.imageCount } : {}),
    });
  }
  evictOldSessions();
  // 记账对齐到盘上已有的条数：下一次 flush 只追加这之后的部分（计数归 journal 所有，见 T6①）
  journal.restored(sessionId, loaded.messages.length);
  sessions.set(sessionId, session);
  return true;
}

/**
 * 按盘分页读历史（6a 的第二半：分页窗口不再是前端数组切片的专利）。
 * `before` 是"从可见历史的第几条往前取"，缺省取最新的一页。
 *
 * **口径不在这里，在 `history-window.ts`**（外部审查 T33）：驻留数组的 index 0 是每轮重装配的
 * system、磁盘数组没有它，两处各自算就会差 1；所以这里只负责"取哪一份数组"，
 * 夹取、剥 system、开窗、计数全部交给那一个纯函数 —— 一条判断只许有一处。
 */
export async function historyPage(
  sessionId: string,
  opts: { limit?: number | undefined; before?: number | undefined } = {},
): Promise<{ messages: ChatMessage[]; total: number; hasMore: number }> {
  const resident = sessions.get(sessionId);
  const all = resident
    ? resident.messages
    : (await store().load(sessionId)).messages.map((m) => ({
        role: m.role,
        content: m.content,
        // 盘上留着的图片计数要带到界面 —— 少带一格，重启后带图的消息
        // 会和纯文字消息长得一模一样（静默丢信息的一种）
        ...(m.imageCount !== undefined ? { imageCount: m.imageCount } : {}),
      }));
  return pickHistoryPage(all, opts);
}

export function isRunning(sessionId: string): boolean {
  return sessions.get(sessionId)?.running ?? false;
}

export interface ChatDeps {
  fetcher?: typeof fetch;
  /** 权限门（由 main 注入权限桥）——**对话链路不再绕过权限** */
  permission: PermissionResolver;
  /** 工作区根目录（未选择时对话仍可用，但工具不可用） */
  workspaceRoot: string | null;
  registry?: ToolRegistry;
  /** 权限模式（W10g 起接入执行路径；不传 = default） */
  mode?: PermissionMode | undefined;
  /** 用户自定义权限规则 */
  rules?: ReadonlyArray<PermissionRule>;
  /** 高危清单（来自配置，引擎级兜底） */
  alwaysAsk?: ReadonlyArray<string>;
  /** 生命周期钩子运行器（W5d） */
  hooks?: HookRunner;
  /** 技能清单文本（W11a）：非空时并进系统提示；内容稳定 → 不破坏模型前缀缓存 */
  skillCatalogText?: string;
  /** 判定事实的出口（执行审计）：对话链路里的每一次工具判定都从这里交出去 */
  onDecision?: (info: GateAuditInfo) => void;
}

/**
 * 发起一轮对话。
 *
 * W5b 起**改走 Agent Loop**（三分支 + maxTurns + 工具串行）：
 * 模型可以真的调工具，写类工具经权限门弹窗确认后才执行。
 * 立即返回 sessionId/messageId，随后通过 emit 持续推送 StreamEvent。
 */
export function sendMessage(
  params: {
    connectionId: string;
    text: string;
    sessionId?: string;
    /** M11 批一：随本条消息发出的图片（已过主进程准入；发信侧还会**再跑一遍**） */
    images?: Array<{ name: string; dataBase64: string }>;
    /**
     * M17 批一：续跑一个被打断的任务（taskId）。带上它 = 这一轮是"接着上次做"，
     * 会注入一次性的续跑段并继续同一条任务记录；校验（存在 / 可续 / id 相符）主要在前置的
     * `resumeReadiness` 里做，这里再读一次是防竞态 —— 坏掉如实报错，**绝不静默换成新轮**。
     */
    resumeTaskId?: string;
  },
  emit: StreamEmitter,
  deps: ChatDeps,
): { sessionId: string; messageId: string } {
  const { connectionId, text } = params;
  const session = params.sessionId
    ? (sessions.get(params.sessionId) ?? buildSession(connectionId))
    : buildSession(connectionId);

  // 记录使用时间：会话上限靠它淘汰"最久未用"的那个（轨道回归计划 1 修 M1）
  session.lastUsedAt = Date.now();

  if (session.running) {
    throw new Error('该会话正在生成中，请先停止或等待完成');
  }

  /**
   * M11 批一：图片在**发信的这侧再跑一遍准入**（渲染层给的字节永远不被信任）——
   * 魔数 / 5MB / 剥离元数据只有一份实现（agent-core 的 image-prep），这里只负责"必须过它"。
   * 不过就整个拒绝（抛给 IPC 边界）：不静默丢图、也不把未剥干净的字节发出去。
   */
  const images: Array<{ mimeType: string; dataBase64: string }> = [];
  for (const raw of params.images ?? []) {
    const bytes = decodeBase64(raw.dataBase64);
    const prepared = bytes === null ? null : prepareImage({ name: raw.name, bytes });
    if (prepared === null || !prepared.ok) {
      throw new Error(prepared === null ? `「${raw.name}」的 base64 数据不合法` : prepared.error);
    }
    images.push({ mimeType: prepared.image.mimeType, dataBase64: prepared.image.dataBase64 });
  }

  const messageId = randomUUID();
  session.messages.push({
    role: 'user',
    content: text,
    // 字节不落盘：内存与磁盘上只留"这条带过几张图"
    ...(images.length > 0 ? { imageCount: images.length } : {}),
  });
  session.running = true;
  const controller = new AbortController();
  session.controller = controller;

  // 后台跑，不阻塞 IPC 返回
  void (async () => {
    let seq = 0;
    let resolved: 'stop' | 'length' | 'content_filter' | 'aborted' | 'error' | 'tool_calls' = 'stop';
    /**
     * M17 批一：本轮的**任务记录**（在内存里随步进更新，落盘由 persistTask 负责）。
     * 置 null 的两种时序：起轮前就抛（校验没过）→ finally 里跳过收口，不写一条假记录。
     */
    let taskRec: TaskRecord | null = null;
    /**
     * 实时输出的中转（R8.7）：**每一轮一份**，按 callId 分线。
     * 交给界面的是"截至此刻的尾部快照"；主进程负责攒批（别一条一事件刷爆 IPC）与保留上限
     * （别把一次刷屏留在内存里）。声明在 `try` 外面，`finally` 才收尾得到它。
     */
    const outputStreams = createToolOutputRelay({
      maxTailChars: TOOL_OUTPUT_TAIL_CHARS,
      flushChars: TOOL_OUTPUT_FLUSH_CHARS,
      quietMs: TOOL_OUTPUT_QUIET_MS,
      pushTail: (callId, name, tail) => {
        emit({ type: 'tool_output', sessionId: session.id, callId, name, tail });
      },
    });

    try {
      /**
       * M17 批一：起轮就落一条任务记录（**在模型被调用之前**）—— 第一轮就在等模型时崩溃也能恢复。
       * 续跑那条路继续同一个 taskId（resumeCount+1）；记录在这之间被换掉（刚发过新消息）就如实报错。
       */
      if (params.resumeTaskId !== undefined) {
        const prev = await taskStore().read(session.id).catch(() => null);
        if (prev === null || prev.taskId !== params.resumeTaskId) {
          throw new Error('要续跑的任务记录已经不在了（可能刚发过新消息）—— 请从卡片重新操作');
        }
        const blocked = resumeBlockReason(prev);
        if (blocked !== null) throw new Error(blocked);
        taskRec = markResumed(prev, new Date());
      } else {
        taskRec = createTask({
          taskId: randomUUID(),
          sessionId: session.id,
          instruction: text,
          now: new Date(),
        });
      }
      await persistTask(session.id, taskRec);

      /**
       * M17 批一：起轮也把**会话元信息**写一份 —— 半途崩溃的那一轮走不到轮末的 flushSession，
       * 没有这一步，会话目录里只有 task.json、清单里没有它（重启后连恢复卡片都找不到）。
       * 与轮末那次同源同形状（metaOf）；条数取 journal 的已记账数（新会话是 0，如实）。
       */
      try {
        await store().saveMeta(metaOf(session, journal.persistedCount(session.id)));
      } catch (err) {
        fail('task', '起轮时会话元信息没写进去（崩溃后这张恢复卡片可能找不到）', err);
      }

      const { record, apiKey } = await resolveConnection(connectionId);

      /**
       * 6b：摘要段与本轮真正发出去的窗口。
       *
       * 两处"宁可退化成没压缩"的判断合起来是一条：**摘要与窗口要么一起生效，要么都不生效。**
       * - 水印 > 0 但摘要文件读不出来 → 不窄化（窄化了模型就既看不到摘要也看不到原文）；
       * - 摘要在、水印还没推进（写盘与推进之间崩掉）→ 不注入摘要（那描述的是"0 条之前"）。
       */
      const summaryText = await store()
        .readSummary(session.id)
        .catch((err: unknown) => {
          fail('compact', '摘要读不出来，本轮按未压缩继续', err);
          return '';
        });
      const summarySection =
        session.compactedThrough > 0
          ? buildSummarySection({
              summary: summaryText,
              through: session.compactedThrough,
              sessionId: session.id,
            })
          : '';
      const effectiveThrough = summarySection === '' ? 0 : session.compactedThrough;

      /**
       * M17 批一：续跑段（**一次性**——只在带 resumeTaskId 的这一轮注入；系统提示每轮重装配，
       * 下一轮自然消失）。字段取自任务记录本身：错一格就是"断在第几步"说错话。
       */
      const taskResumeSection =
        taskRec !== null && params.resumeTaskId !== undefined
          ? buildTaskResumeSection({
              sessionId: session.id,
              instruction: taskRec.instruction,
              stepsDone: taskRec.stepsDone,
              recentSteps: taskRec.recentSteps,
              runningStep: taskRec.runningStep,
            })
          : '';

      // W8：按工作区动态装配系统提示（项目指令 → 长期记忆 → 会话摘要）
      // 每一层都标注来源，便于用户核查「模型为什么这么说」。
      if (deps.workspaceRoot !== null) {
        try {
          const [project, notes] = await Promise.all([
            loadProjectContext(deps.workspaceRoot),
            loadNotes(deps.workspaceRoot),
          ]);
          const assembled = assembleSystemPrompt({
            base: BASE_PROMPT,
            project: project.text,
            notes: notes.text,
            // ②"有出处"：段头要写明条数，用户数得出来才算数
            notesCount: notes.lines,
            sessionSummary: summarySection,
            taskResume: taskResumeSection,
          });
          const first = session.messages[0];
          if (first && first.role === 'system') {
            // 技能清单只在需要时追加；它必须**逐字节稳定**，否则每轮系统提示都在变、模型缓存全失效
            const catalog = deps.skillCatalogText ?? '';
            first.content = catalog === '' ? assembled : `${assembled}\n\n${catalog}`;
          }
        } catch (err) {
          // 记忆装配失败不能让对话挂掉：退回基础人格，并留下日志
          fail('memory', '装配失败，退回基础人格', err);
        }
      }

      if (deps.workspaceRoot === null) {
        // 没有工作区：仍可对话，但工具一律会因路径校验失败而拒绝。这里如实把情况写进上下文，
        // 避免模型反复尝试反复失败的工具调用。
        // **不往消息数组里逐轮追加**（T40 审计项，2026-10-14 修）：旧写法每轮 push 一条 system，
        // 上下文逐轮增长，且用户中途选好工作区后旧的"尚未选择"仍留在历史里自相矛盾 ——
        // 现在并入下方 headParts 的一次性重拼（每轮覆盖、绝不累积）。
        const firstSystem = session.messages[0];
        const headParts = [BASE_PROMPT, NO_WORKSPACE_NOTICE, summarySection, taskResumeSection].filter(
          (s) => s !== '',
        );
        if (firstSystem?.role === 'system' && headParts.length > 1) {
          firstSystem.content = headParts.join('\n\n');
        }
      }

      // W5d-b：SessionStart 钩子 —— 只在会话第一轮触发一次（此时 messages 里还没有任何对话内容）。
      // 钩子给的上下文**注入系统提示**，而不是伪造一条用户消息：钩子说的不是用户说的。
      if (deps.hooks && !session.startedHookFired) {
        session.startedHookFired = true;
        try {
          const started = await sessionStart(deps.hooks, {
            sessionId: session.id,
            cwd: deps.workspaceRoot ?? '__no_workspace__',
          });
          if (started.context !== '') {
            const first = session.messages[0];
            if (first && first.role === 'system') {
              first.content = `${first.content}\n\n${started.context}`;
            } else {
              session.messages.unshift({ role: 'system', content: started.context });
            }
          }
        } catch (err) {
          // 钩子失败不能让对话挂掉（钩子契约里也是 fail-open），但必须留下痕迹
          fail('hooks', 'SessionStart 失败', err);
        }
      }

      // 发给模型的只是**窗口**：内存与磁盘上的完整记录一条都不动（见 model-history.ts 的注释）
      // M11：parts 只挂在**出站副本**的最后一条 user 上（会话内存与磁盘保持纯文本）
      const outbound = withContentParts(
        buildModelHistory(session.messages, effectiveThrough),
        buildContentParts(text, images),
      );
      const result = await runAgentTurn(
        {
          connection: { baseUrl: record.baseUrl, apiKey, model: record.model },
          messages: outbound,
          maxTurns: MAX_TURNS,
          // 只带"用户主动停止"这一个信号。时间界限归 provider 管（空闲 / 单次调用上限），
          // 因为只有它看得见数据有没有在流；以前这里挂的是盖住整轮的 5 分钟总超时（T7 已纠）。
          signal: controller.signal,
          emit: (ev: LoopEvent) => {
            if (ev.type === 'text_delta') {
              emit({
                type: 'text_delta',
                sessionId: session.id,
                messageId,
                seq: seq++,
                delta: ev.delta,
              });
            } else if (ev.type === 'usage') {
              emit({
                type: 'usage',
                sessionId: session.id,
                inputTokens: ev.inputTokens,
                outputTokens: ev.outputTokens,
              });
            } else if (ev.type === 'tool_start') {
              emit({
                type: 'tool_start',
                sessionId: session.id,
                callId: ev.callId,
                name: ev.name,
                argumentsText: ev.argumentsText,
              });
              // M17 批一：任务记录跟着步子走（**不落盘就永远说不出"断在哪"**）。
              // 写是异步的、失败只告警（persistTask）—— 记恢复用的账不该拖慢正在跑的对话。
              if (taskRec !== null) {
                taskRec = stepStarted(taskRec, ev.name, new Date());
                void persistTask(session.id, taskRec);
              }
            } else if (ev.type === 'tool_output') {
              outputStreams.onChunk(ev.callId, ev.name, ev.chunk);
            } else if (ev.type === 'tool_end') {
              // 先补发这份尾巴再发 tool_end：界面收到的顺序必须与真实发生顺序一致
              // （反过来会看到"先显示完成、后又冒出一段输出"）
              outputStreams.onEnd(ev.callId);
              emit({
                type: 'tool_end',
                sessionId: session.id,
                callId: ev.callId,
                name: ev.name,
                ok: ev.ok,
                summary: ev.summary,
                durationMs: ev.durationMs,
              });
              // 失败的一步也计数（做过就是做过，成败记在 recentSteps[].ok）
              if (taskRec !== null) {
                taskRec = stepFinished(taskRec, ev.name, ev.ok, new Date());
                void persistTask(session.id, taskRec);
              }
            }
            // turn_end 仅供调试，不推给渲染层
          },
        },
        {
          registry: deps.registry ?? createDefaultRegistry(),
          // 未选工作区时给一个不可能的根目录：工具会在 guard 阶段被拒（fail closed）
          workspaceRoot: deps.workspaceRoot ?? '__no_workspace__',
          permission: deps.permission,
          alwaysAllow: session.alwaysAllow,
          ...(deps.mode ? { mode: deps.mode } : {}),
          ...(deps.rules ? { rules: deps.rules } : {}),
          ...(deps.alwaysAsk ? { alwaysAsk: deps.alwaysAsk } : {}),
          ...(deps.hooks ? { hooks: deps.hooks } : {}),
          ...(deps.onDecision ? { onDecision: deps.onDecision } : {}),
          sessionId: session.id,
          ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
        },
      );

      // 用 loop 返回的部分**只接回本轮新增**（含 assistant 的 tool_calls 与 tool 结果）。
      // 直接整体赋值等于把窗口当成历史 —— 被压缩掉的旧消息会从内存里消失，journal 的按条数记账随之错位。
      session.messages = mergeTurnResult(session.messages, outbound, result.messages);

      if (result.reason === 'error' && result.error) {
        resolved = 'error';
        emit({
          type: 'error',
          sessionId: session.id,
          code: 'loop_error',
          message: result.error,
        });
      } else if (result.reason === 'max_turns') {
        // 熔断不是静默结束：如实告知用户为何停下
        resolved = 'error';
        emit({
          type: 'error',
          sessionId: session.id,
          code: 'max_turns',
          message: result.error ?? `已达到最大迭代次数（${MAX_TURNS}）`,
        });
      } else if (result.reason === 'aborted') {
        resolved = 'aborted';
      } else if (result.truncated !== null) {
        // 被上游掐了半截（T26）：既不是"正常写完"，也不是错误 —— 单独一个原因，界面才说得出话。
        // 修之前这一格根本不存在，length 与 content_filter 一路被归并成 stop。
        resolved = result.truncated;
      } else {
        resolved = 'stop';
      }
    } catch (err) {
      resolved = 'error';
      emit({
        type: 'error',
        sessionId: session.id,
        code: (err as { code?: string }).code ?? 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      session.running = false;
      session.controller = null;
      // 用户中途停止 / 出错时也要把压着的输出交出去：已经跑出来的东西不该因为"没跑完"而消失
      outputStreams.closeAll();
      // **落盘点在轮次结束处**，不是每条 token：中途写会把半截回答留在盘上，
      // 也让一次长回答产生成百上千次 IO。返回值 = 消息写失败的原文（R25：要递给界面）
      const persistError = await flushSession(session);
      // M17 批一：任务记录收口（aborted / error 各有各的结局；其余 —— 正常答完 / 被截断 /
      // 停在工具处 —— 都记 done：精确"为什么停"由 done 事件与截断提示在界面上说清，这里只记任务层终态）
      if (taskRec !== null) {
        const outcome = resolved === 'aborted' ? 'aborted' : resolved === 'error' ? 'failed' : 'done';
        taskRec = finishTask(taskRec, outcome, new Date());
        await persistTask(session.id, taskRec);
      }
      emit({
        type: 'done',
        sessionId: session.id,
        reason: resolved,
        // R25：落盘失败要说给用户听（旧行为只进 console —— 重启后"这段怎么没了"没人解释）
        notice:
          persistError === null
            ? null
            : `这一轮没能写进磁盘历史（重启后这一段会消失）：${persistError}`,
      });
    }
  })();

  return { sessionId: session.id, messageId };
}

export function stopMessage(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session?.controller) return false;
  session.controller.abort();
  return true;
}

/* ======================= M17 批一：断点续跑（任务记录） ======================= *
 *
 * 口径见 `docs/DESIGN-M17.md`：记录与消息分家（task.json vs messages.jsonl）；
 * 「被读到时还是 running」= 上次进程没走完 —— 这里做**读时判定**并写回（幂等）。
 */

/**
 * 读某会话的任务记录（供界面卡片）。**读时判定**：还是 `running` 的 = 上次进程被崩溃/强退带走，
 * 这里就地标 `interrupted` 并写回；读不出来（无记录/坏文件）= null。
 * **先问"这一轮还活着吗"**：进程内有正在跑的轮次（如定时任务到点）时不判 ——
 * 活着的轮次不是"被打断"（第二遍复核抓到的形态，见 `interruptIfRunning` 的 `sessionAlive`）。
 */
export async function taskStatusFor(sessionId: string): Promise<ChatTaskView | null> {
  const rec = await taskStore().read(sessionId).catch(() => null);
  if (rec === null) return null;
  const { record, changed } = interruptIfRunning(rec, new Date(), sessionTurnAlive(sessionId));
  if (changed) await persistTask(sessionId, record);
  return {
    sessionId,
    taskId: record.taskId,
    status: record.status,
    stepsDone: record.stepsDone,
    runningStep: record.runningStep,
    instructionPreview: record.instruction.slice(0, 80),
    text: describeInterruption(record),
    resumeCount: record.resumeCount,
  };
}

/** 进程内这个会话是否有正在跑的一轮（读时判定与续跑校验的前置：活着的轮次不许被判、不许被续） */
function sessionTurnAlive(sessionId: string): boolean {
  return sessions.get(sessionId)?.running === true;
}

/**
 * 点「续跑」前的**前置校验**（在 IPC 层调用 —— 失败以 IPC 结果返回，界面才显示得出原因，
 * 而不是把错误掉进聊天流的 catch 里）。传了 taskId：记录被换掉（刚发过新消息）也算失败。
 */
export async function resumeReadiness(
  sessionId: string,
  taskId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rec = await taskStore().read(sessionId).catch(() => null);
  if (rec === null) return { ok: false, error: '这个会话没有任务记录' };
  const marked = interruptIfRunning(rec, new Date(), sessionTurnAlive(sessionId));
  if (marked.changed) await persistTask(sessionId, marked.record);
  if (marked.record.taskId !== taskId) {
    return { ok: false, error: '任务记录已经变了（可能刚发过新消息）—— 请从卡片重新操作' };
  }
  const blocked = resumeBlockReason(marked.record);
  if (blocked !== null) return { ok: false, error: blocked };
  return { ok: true };
}

/** 会话归属的连接 id（驻留内存优先，否则读盘清单；与补问预览同一口径） */
export async function connectionForSession(sessionId: string): Promise<string | null> {
  const resident = sessions.get(sessionId)?.connectionId;
  if (resident !== undefined && resident !== '') return resident;
  const metas = await store().list().catch(() => []);
  return metas.find((m) => m.id === sessionId)?.connectionId ?? null;
}

/** 点「不再提示」：只把记录标掉（interrupted → dismissed），不动消息、不调模型 */
export async function taskDismiss(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const rec = await taskStore().read(sessionId).catch(() => null);
  if (rec === null) return { ok: false, error: '这个会话没有任务记录' };
  const marked = interruptIfRunning(rec, new Date(), sessionTurnAlive(sessionId)).record;
  // 只有"被打断"的记录可以被关掉：还在跑的（sessionAlive）、已收口的都不该被这一下改状态
  if (marked.status !== 'interrupted') {
    return { ok: false, error: '这条任务当前不在「被打断」状态，不需要关掉' };
  }
  await persistTask(sessionId, markDismissed(marked, new Date()));
  return { ok: true };
}

/* ======================= 6b：会话压缩与「结束记要点」 ======================= *
 *
 * 这一层只做编排。判断、坐标、prompt 文本全在**已经单测过**的纯模块里：
 * `agent-core/context/compaction.ts`（阈值 / 水印 / 注入段 / prompt）、`model-history.ts`（窗口与接回）、
 * `pending-notes.ts`（待记要点的账）。`chat-service` 依赖 electron、进不了 vitest，
 * 所以这里的每一句都保持"一句话能核对"，运行期行为交给 e2e 第 29、30 步问真值。
 *
 * 三条硬规矩（都来自已批的报备）：
 * - **压缩只由人发起**：本文件没有任何"到阈值就自动压"的路径，阈值只产出一句提示；
 * - **摘要与水印要么一起生效要么都不生效**：写盘失败就把水印退回原值；
 * - **B 永远不在退出时写盘**：退出只记一笔待办，下次启动问过、看过预览，才进长期记忆。
 */

/** 一次性模型调用：只收文本、**不带 tools 字段**（不给工具 = 摘要轮没有顺手改文件的能力） */
async function completeOnce(connectionId: string, prompt: string): Promise<string> {
  const { record, apiKey } = await resolveConnection(connectionId);
  let text = '';
  for await (const ev of streamChat({
    baseUrl: record.baseUrl,
    apiKey,
    model: record.model,
    messages: [{ role: 'user', content: prompt }],
  })) {
    if (ev.type === 'text_delta') text += ev.delta;
  }
  return text.replace(/\s+/g, ' ').trim();
}

export interface CompactStatus {
  /** 到阈值了 —— 界面**只提示**，不自动压 */
  shouldPrompt: boolean;
  reason: string;
  compactedThrough: number;
  rounds: number;
  bytes: number;
  /** 未压缩的消息条数 */
  messages: number;
  /** 落盘总条数（水印的坐标系就是它） */
  totalMessages: number;
  /** 这一版摘要落盘的时间（ISO）；'' = 还没写过摘要 */
  summaryStoredAt: string;
}

export async function compactStatus(sessionId: string): Promise<CompactStatus | null> {
  const s = sessions.get(sessionId);
  if (s === undefined) return null;
  const shape = measureContext(s.messages, s.compactedThrough);
  const verdict = decideCompactPrompt(shape);
  return {
    shouldPrompt: verdict.shouldPrompt,
    reason: verdict.reason,
    compactedThrough: s.compactedThrough,
    rounds: shape.rounds,
    bytes: shape.uncompressedBytes,
    messages: shape.uncompressedMessages,
    totalMessages: journal.persistedCount(s.id),
    // 一次 stat 换"这版摘要是啥时候存下的"，比再持久化一个时间字段少一个真相来源
    summaryStoredAt: await store()
      .summaryStoredAt(s.id)
      .catch(() => ''),
  };
}

export type CompactPreview =
  | { ok: true; summary: string; truncated: boolean; willCover: number }
  | { ok: false; error: string };

/** 生成摘要给人看 —— **这一步什么都不写**：落盘只发生在 compactApply 之后 */
export async function compactPreview(sessionId: string): Promise<CompactPreview> {
  const s = sessions.get(sessionId);
  if (s === undefined) return { ok: false, error: '这个会话当前没打开，先在对话页选回它' };
  if (s.running) return { ok: false, error: '这个会话正在生成回答，等它说完再压缩' };
  const prompt = buildCompactPrompt(s.messages, s.compactedThrough);
  if (prompt === '') return { ok: false, error: '没有需要压缩的新内容，本次什么都没做' };
  // 失败不区分原因也不谎报：只说"没生成"，并明确什么都没改
  const text = await completeOnce(s.connectionId, prompt).catch(() => '');
  if (text === '') {
    return { ok: false, error: '摘要没生成（无密钥 / 超时 / 额度不足都可能）。原始记录与水印都没动' };
  }
  const capped = capSummary(text);
  return {
    ok: true,
    summary: capped.text,
    truncated: capped.truncated,
    willCover: journal.persistedCount(s.id),
  };
}

/** 用户看过预览并点了「就按这版存」之后才到这里 */
export async function compactApply(
  sessionId: string,
  summary: string,
): Promise<{ ok: boolean; compactedThrough: number; error?: string }> {
  const s = sessions.get(sessionId);
  if (s === undefined) return { ok: false, compactedThrough: 0, error: '这个会话当前没打开' };
  const body = summary.trim();
  if (body === '') {
    return { ok: false, compactedThrough: s.compactedThrough, error: '空摘要不会被保存：那等于把早先的事实抹成空白' };
  }
  const through = journal.persistedCount(s.id);
  const previous = s.compactedThrough;
  if (through <= previous) {
    return { ok: false, compactedThrough: previous, error: '没有比上次更新的内容可压，水印没动' };
  }
  try {
    await store().writeSummary(s.id, body);
    s.compactedThrough = through;
    await store().saveMeta(metaOf(s, through));
  } catch (err) {
    // 半状态不留：摘要没写成 / 元信息没推进，就退回"未压缩"，模型照旧看原文
    s.compactedThrough = previous;
    return {
      ok: false,
      compactedThrough: previous,
      error: `保存失败：${err instanceof Error ? err.message : String(err)}，已退回压缩前的状态`,
    };
  }
  return { ok: true, compactedThrough: through };
}

/** 待记要点的账（进程级懒建，与 session store 同一个理由：模块加载期不能碰 electron 路径） */
let pendingRef: PendingNotes | null = null;

/**
 * 本进程里"这条账已经处理过了"的凭据：会话 id → 处理当时已落盘几条。
 * 只在内存里，不落盘 —— 它管的是"这一次运行别问第二遍"，跨进程的事实仍在 pending-notes.json。
 */
const notedThrough = new Map<string, number>();

function pendingNotes(): PendingNotes {
  if (pendingRef === null) pendingRef = createPendingNotes(join(getDataRoot(), 'pending-notes.json'));
  return pendingRef;
}

export function __setPendingNotesForTests(injected: PendingNotes | null): void {
  pendingRef = injected;
}

/** 用户显式「结束并记要点」：只记账，不写盘、不调模型 */
export async function markSessionEnded(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const s = sessions.get(sessionId);
  if (s === undefined) return { ok: false, error: '这个会话当前没打开' };
  const firstUser = persistable(s).find((m) => m.role === 'user');
  if (firstUser === undefined) {
    // 空会话没东西可记：明确说出来，别留一条下次会追问的空账
    return { ok: false, error: '这个会话还没有对话内容，没有要记的要点' };
  }
  const title = firstUser.content.slice(0, 40);
  await pendingNotes().mark(s.id, title);
  return { ok: true };
}

/** 退出时给每个"有内容、且记过之后又多聊了东西"的驻留会话留一笔账（绝不调模型） */
export async function markAllResidentEnded(): Promise<number> {
  let marked = 0;
  for (const s of sessions.values()) {
    if (s.running) continue; // 正在生成的等它落完盘，那轮由用户自己结束
    const all = persistable(s);
    if (!all.some((m) => m.role === 'user')) continue;
    const total = journal.persistedCount(s.id);
    // 这一屏话刚记过要点（或用户明说"不记"），别再问第二遍 —— 除非之后又聊出了新内容
    if (!shouldAskAgain(notedThrough.get(s.id) ?? -1, total)) continue;
    const title = all.find((m) => m.role === 'user')?.content.slice(0, 40) ?? '（无标题）';
    await pendingNotes().mark(s.id, title);
    marked += 1;
  }
  return marked;
}

export interface PendingNotesView {
  items: { sessionId: string; title: string; markedAt: string }[];
  neverAsk: boolean;
}

export async function pendingNotesList(): Promise<PendingNotesView> {
  const ledger = pendingNotes();
  return { items: await ledger.list(), neverAsk: await ledger.neverAsk() };
}

/**
 * 补问时先给预览：这一步也不写盘。
 *
 * 用哪条连接**由会话自己决定**（批复⑤："摘要用会话当前那条连接"），不接受渲染层指定：
 * 界面顶部选中的连接完全可能不是这个会话当初用的那条 —— 那就变成"用另一条连接、另一份额度"
 * 去替这段对话写总结，而且 `hydrateSession` 还会把这个连接名写进会话里。
 */
export async function pendingNotePreview(
  sessionId: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let connectionId = sessions.get(sessionId)?.connectionId ?? '';
  if (connectionId === '') {
    const metas = await store().list().catch(() => []);
    const meta = metas.find((m) => m.id === sessionId);
    if (meta === undefined) return { ok: false, error: '这个会话读不出来了（磁盘上没有它）' };
    connectionId = meta.connectionId;
  }
  await hydrateSession(sessionId, connectionId);
  const s = sessions.get(sessionId);
  if (s === undefined) return { ok: false, error: '这个会话读不出来了（磁盘上没有它）' };
  const prompt = buildNotePrompt(persistable(s));
  if (prompt === '') return { ok: false, error: '这个会话没有可记的内容' };
  const text = await completeOnce(s.connectionId, prompt).catch(() => '');
  if (text === '') {
    return { ok: false, error: '要点没生成（无密钥 / 超时 / 额度不足都可能）。什么都没写' };
  }
  return { ok: true, text: capSummary(text).text };
}

/**
 * 用户点「记」之后才落长期记忆；点「不记 / 不再问」只清账。
 *
 * 三条分支都会留下"这一屏话已经处理过了"的凭据（`notedHere`），否则退出时
 * `markAllResidentEnded` 会把刚处理完的会话重新记上一笔、下次启动再问一遍。
 * 「记」按**当时的落盘条数**留底：之后又聊出新的，才值得再问；
 * 「不记 / 不再问」是就这一整段话说的，本进程内不再因为它追问。
 */
const NOTE_DONE_FOREVER = Number.MAX_SAFE_INTEGER;

export async function pendingNoteResolve(args: {
  sessionId: string;
  action: 'remember' | 'skip' | 'never';
  text: string;
  workspaceRoot: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const ledger = pendingNotes();
  if (args.action === 'never') {
    await ledger.setNeverAsk(true);
    await ledger.clear(args.sessionId);
    notedThrough.set(args.sessionId, NOTE_DONE_FOREVER);
    return { ok: true };
  }
  if (args.action === 'skip') {
    await ledger.clear(args.sessionId);
    notedThrough.set(args.sessionId, NOTE_DONE_FOREVER);
    return { ok: true };
  }
  if (args.workspaceRoot === null) {
    return { ok: false, error: '还没选工作区：长期记忆没有可写的地方（先在「概览」页选目录）' };
  }
  const body = args.text.trim();
  if (body === '') return { ok: false, error: '要点是空的，没有写进去' };
  try {
    await appendNote(args.workspaceRoot, body);
  } catch (err) {
    // 路径守卫拒绝时必须说出来 —— 静默失败就是"用户点了记，账上却少了"
    return { ok: false, error: `没写进去：${err instanceof Error ? err.message : String(err)}` };
  }
  await ledger.clear(args.sessionId);
  notedThrough.set(args.sessionId, journal.persistedCount(args.sessionId));
  return { ok: true };
}
