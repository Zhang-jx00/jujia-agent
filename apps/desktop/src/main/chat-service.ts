import { randomUUID } from 'node:crypto';
import { streamChat, withTimeout, type ChatMessage } from '@jujia/agent-core';
import type { StreamEvent } from '@jujia/shared-ipc';
import { resolveConnection } from './connections-store';

/** W2 的极简系统提示；W3 起由 memory 模块装配（含 blocks 与压缩） */
const SYSTEM_PROMPT = '你是俱佳Agent，一个运行在用户 Windows 桌面上的助手。回答简洁、准确，使用中文。';

/**
 * 单轮对话的整体超时（含流式接收）。
 *
 * 复核 002 发现：初版对话链路**没有任何超时**——上游卡住（接受连接但不响应）时会永久挂起，
 * 用户只能靠「停止」按钮自救。此处补上有界保护；超时会被 agent-core 识别为 `timeout` 错误，
 * 以「上游在超时时间内没有响应」如实提示用户，而不是伪装成网络错误。
 * 待 W6 设置页落地后改为用户可调。
 */
const CHAT_TIMEOUT_MS = 300_000;

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
    let failureReason: 'stop' | 'length' | 'aborted' | 'error' | 'tool_calls' = 'stop';
    let errored = false;

    try {
      const { record, apiKey } = await resolveConnection(connectionId);
      const gen = streamChat(
        {
          baseUrl: record.baseUrl,
          apiKey,
          model: record.model,
          messages: session.messages,
          // 用户中止（controller）与整体超时合并：两者语义不同，交由 provider 层分别识别
          signal: withTimeout(controller.signal, CHAT_TIMEOUT_MS),
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
          // 对话页当前未启用工具执行（W5 起改为走 Agent Loop）；
          // 若模型仍请求了工具，如实把 tool_calls 传给渲染层提示用户，而不是假装成正常结束
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
