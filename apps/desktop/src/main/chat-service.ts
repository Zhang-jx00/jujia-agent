import { randomUUID } from 'node:crypto';
import {
  assembleSystemPrompt,
  createDefaultRegistry,
  loadNotes,
  loadProjectContext,
  runAgentTurn,
  sessionStart,
  type ChatMessage,
  type LoopEvent,
  type PermissionMode,
  type PermissionResolver,
  type HookRunner,
  type PermissionRule,
  type ToolRegistry,
} from '@jujia/agent-core';
import type { StreamEvent } from '@jujia/shared-ipc';
import { resolveConnection } from './connections-store';
import { createSessionJournal } from './session-journal';
import { needsEviction, pickEvictionCandidate } from './session-lru';
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
  return {
    id: s.id,
    connectionId: s.connectionId,
    title: (firstUser?.content ?? '（无标题）').slice(0, 40),
    createdAt: s.createdAt,
    lastUsedAt: new Date(s.lastUsedAt).toISOString(),
    messageCount,
    compactedThrough: 0,
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

/** ChatMessage → 入库形态（`system` 不落盘由 `persistable` 负责过滤） */
function toStored(m: ChatMessage): StoredMessage {
  return toStoredMessage(m.role as StoredRole, m.content, new Date(), {
    ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
    ...(m.toolCalls !== undefined
      ? { toolCalls: m.toolCalls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })) }
      : {}),
  });
}

/**
 * 把本轮新增的消息追加落盘。**只追加完整行**，所以进程中途死最多丢最后一条。
 * 失败不静默：console.warn 报出来（丢历史是可感知的事实，不能假装写成功）。
 *
 * 两种失败要分开说（T6①）：**消息没写进去**才是"历史丢了"；
 * **元信息没写进去**只是"列表里的条数 / 标题旧了一格"，下一轮不会因此重放消息。
 */
async function flushSession(s: Session): Promise<void> {
  const all = persistable(s);
  try {
    const out = await journal.flush(s.id, all.map(toStored), (total) => metaOf(s, total));
    if (out.metaError !== null) {
      console.warn(
        `[chat] 会话 ${s.id.slice(0, 8)} 的消息已落盘，但元信息没写进去（清单条数会旧一格，不会重复追加）：`,
        out.metaError,
      );
    }
  } catch (err) {
    console.warn(`[chat] 会话 ${s.id.slice(0, 8)} 的历史没写进去：`, err);
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
      `[chat] 会话数达到上限 ${MAX_SESSIONS}，已从内存卸载最久未使用的会话（历史已落盘，重启后仍可继续）`,
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
  };
  for (const m of loaded.messages) {
    session.messages.push({
      role: m.role,
      content: m.content,
      ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
      ...(m.toolCalls !== undefined
        ? { toolCalls: m.toolCalls.map((c) => ({ id: c.id, name: c.name, argumentsText: c.argumentsText })) }
        : {}),
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
 * `before` 是"从第几条往前取"的下标，缺省取最新的一页。
 */
export async function historyPage(
  sessionId: string,
  opts: { limit?: number | undefined; before?: number | undefined } = {},
): Promise<{ messages: ChatMessage[]; total: number; hasMore: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 120, 1), 400);
  const resident = sessions.get(sessionId);
  const all = resident
    ? resident.messages
    : (await store().load(sessionId)).messages.map((m) => ({ role: m.role, content: m.content }));
  const end = Math.min(opts.before ?? all.length, all.length);
  const start = Math.max(end - limit, 0);
  return { messages: all.slice(start, end), total: all.length, hasMore: start };
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
}

/**
 * 发起一轮对话。
 *
 * W5b 起**改走 Agent Loop**（三分支 + maxTurns + 工具串行）：
 * 模型可以真的调工具，写类工具经权限门弹窗确认后才执行。
 * 立即返回 sessionId/messageId，随后通过 emit 持续推送 StreamEvent。
 */
export function sendMessage(
  params: { connectionId: string; text: string; sessionId?: string },
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

  const messageId = randomUUID();
  session.messages.push({ role: 'user', content: text });
  session.running = true;
  const controller = new AbortController();
  session.controller = controller;

  // 后台跑，不阻塞 IPC 返回
  void (async () => {
    let seq = 0;
    let resolved: 'stop' | 'length' | 'aborted' | 'error' | 'tool_calls' = 'stop';

    try {
      const { record, apiKey } = await resolveConnection(connectionId);

      // W8：按工作区动态装配系统提示（项目指令 → 长期记忆）
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
          });
          const first = session.messages[0];
          if (first && first.role === 'system') {
            // 技能清单只在需要时追加；它必须**逐字节稳定**，否则每轮系统提示都在变、模型缓存全失效
            const catalog = deps.skillCatalogText ?? '';
            first.content = catalog === '' ? assembled : `${assembled}\n\n${catalog}`;
          }
        } catch (err) {
          // 记忆装配失败不能让对话挂掉：退回基础人格，并留下日志
          console.warn('[memory] 装配失败，退回基础人格:', err instanceof Error ? err.message : err);
        }
      }

      if (deps.workspaceRoot === null) {
        // 没有工作区：仍可对话，但工具一律会因路径校验失败而拒绝。
        // 这里如实把情况写进上下文，避免模型反复尝试反复失败的工具调用。
        session.messages.push({
          role: 'system',
          content: '当前尚未选择工作区，所有文件类工具都不可用。若用户要求读写文件，请提示其先在「概览」页选择工作区。',
        });
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
          console.warn('[hooks] SessionStart 失败:', err instanceof Error ? err.message : err);
        }
      }

      const result = await runAgentTurn(
        {
          connection: { baseUrl: record.baseUrl, apiKey, model: record.model },
          messages: session.messages,
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
            } else if (ev.type === 'tool_end') {
              emit({
                type: 'tool_end',
                sessionId: session.id,
                callId: ev.callId,
                name: ev.name,
                ok: ev.ok,
                summary: ev.summary,
                durationMs: ev.durationMs,
              });
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
          sessionId: session.id,
          ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
        },
      );

      // 用 loop 返回的完整消息序列替换会话历史（含 assistant 的 tool_calls 与 tool 结果）
      session.messages = result.messages;

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
      } else {
        resolved = result.branch === 'handoff' ? 'stop' : 'stop';
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
      // **落盘点在轮次结束处**，不是每条 token：中途写会把半截回答留在盘上，
      // 也让一次长回答产生成百上千次 IO
      await flushSession(session);
      emit({ type: 'done', sessionId: session.id, reason: resolved });
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
