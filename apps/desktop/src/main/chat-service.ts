import { randomUUID } from 'node:crypto';
import { streamChat, type ChatMessage } from '@jujia/agent-core';
import type { StreamEvent } from '@jujia/shared-ipc';
import { resolveConnection } from './connections-store';

/** W2 的极简系统提示；W3 起由 memory 模块装配（含 blocks 与压缩） */
const SYSTEM_PROMPT = '你是俱佳Agent，一个运行在用户 Windows 桌面上的助手。回答简洁、准确，使用中文。';

export type StreamEmitter = (event: StreamEvent) => void;

interface Session {
  id: string;
  connectionId: string;
  messages: ChatMessage[];
  controller: AbortController | null;
  running: boolean;
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
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    controller: null,
    running: false,
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

/**
 * 发起一轮对话。
 * 立即返回 sessionId/messageId，随后通过 emit 持续推送 StreamEvent——
 * 这样渲染层不必等整段回复，也便于「可停止」。
 */
export function sendMessage(
  params: { connectionId: string; text: string; sessionId?: string },
  emit: StreamEmitter,
  deps: { fetcher?: typeof fetch } = {},
): { sessionId: string; messageId: string } {
  const { connectionId, text } = params;
  const session = params.sessionId ? sessions.get(params.sessionId) ?? buildSession(connectionId) : buildSession(connectionId);

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
    let assistantText = '';
    let seq = 0;
    let failureReason: 'stop' | 'length' | 'aborted' | 'error' = 'stop';
    let errored = false;

    try {
      const { record, apiKey } = await resolveConnection(connectionId);
      const gen = streamChat(
        {
          baseUrl: record.baseUrl,
          apiKey,
          model: record.model,
          messages: session.messages,
          signal: controller.signal,
        },
        deps,
      );

      for await (const ev of gen) {
        if (ev.type === 'text_delta') {
          assistantText += ev.delta;
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
        } else if (ev.type === 'done') {
          failureReason = ev.reason;
        }
      }
    } catch (err) {
      errored = true;
      failureReason = 'error';
      emit({
        type: 'error',
        sessionId: session.id,
        code: (err as { code?: string }).code ?? 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      session.running = false;
      session.controller = null;
      // 只把「模型真正产出过的内容」写回历史；错误轮次不污染上下文
      if (assistantText) session.messages.push({ role: 'assistant', content: assistantText });
      emit({ type: 'done', sessionId: session.id, reason: errored ? 'error' : failureReason });
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
