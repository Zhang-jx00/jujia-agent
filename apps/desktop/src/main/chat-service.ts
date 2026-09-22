import { randomUUID } from 'node:crypto';
import {
  assembleSystemPrompt,
  createDefaultRegistry,
  loadNotes,
  loadProjectContext,
  runAgentTurn,
  withTimeout,
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

/**
 * 基础人格。**注意**：项目指令与长期记忆不写死在这里，而是每次发送时按工作区动态装配
 * （见 memory 模块），这样换工作区就能换上下文，且用户可随时查看/编辑来源文件。
 */
const BASE_PROMPT = '你是俱佳Agent，一个运行在用户 Windows 桌面上的助手。回答简洁、准确，使用中文。';

/**
 * 单轮对话的整体超时（含流式接收与工具执行）。
 *
 * 复核 002 发现：初版对话链路**没有任何超时**——上游卡住时会永久挂起。
 * 此处保留有界保护；超时被 agent-core 识别为 `timeout` 错误，如实提示而非伪装成网络错误。
 */
const CHAT_TIMEOUT_MS = 300_000;

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
  controller: AbortController | null;
  running: boolean;
  /** 会话级「总是允许」白名单（工具名） */
  alwaysAllow: Set<string>;
}

const sessions = new Map<string, Session>();

/** 仅用于测试 */
export function __resetSessions(): void {
  sessions.clear();
}

function buildSession(connectionId: string): Session {
  const session: Session = {
    id: randomUUID(),
    connectionId,
    messages: [{ role: 'system', content: BASE_PROMPT }],
    controller: null,
    running: false,
    alwaysAllow: new Set<string>(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getHistory(sessionId: string): ChatMessage[] {
  return sessions.get(sessionId)?.messages ?? [];
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
  /** 生命周期钩子运行器（W5d） */
  hooks?: HookRunner;
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
          if (first && first.role === 'system') first.content = assembled;
        } catch (err) {
          // 记忆装配失败不能让对话挂掉：退回基础人格，并留下日志
          console.warn('[memory] 装配失败，退回基础人格:', err instanceof Error ? err.message : err);
        }
      }

      if (deps.workspaceRoot === null) {
        // 没有工作区：仍可对话，但工具一律会因路径校验失败而拒绝。
        // 这里如实把情况写进上下文，避免模型反复尝试注定失败的工具调用。
        session.messages.push({
          role: 'system',
          content: '当前尚未选择工作区，所有文件类工具都不可用。若用户要求读写文件，请提示其先在「概览」页选择工作区。',
        });
      }

      const result = await runAgentTurn(
        {
          connection: { baseUrl: record.baseUrl, apiKey, model: record.model },
          messages: session.messages,
          maxTurns: MAX_TURNS,
          signal: withTimeout(controller.signal, CHAT_TIMEOUT_MS),
          emit: (ev: LoopEvent) => {
            if (ev.type === 'text_delta') {
              emit({
                type: 'text_delta',
                sessionId: session.id,
                messageId,
                seq: seq++,
                delta: ev.delta,
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
