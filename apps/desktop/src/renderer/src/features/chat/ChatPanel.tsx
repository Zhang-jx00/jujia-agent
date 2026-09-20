import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ConnectionView, StreamEvent } from '@jujia/shared-ipc';

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 仍在流式接收中 */
  streaming?: boolean;
  /** 出错信息（若有） */
  error?: string;
}

/** 工具调用的一行记录（工具卡 L0 的最简形态；完整卡片属 W6） */
interface ToolLine {
  callId: string;
  name: string;
  phase: 'running' | 'done';
  ok?: boolean;
  summary?: string;
  durationMs?: number;
}

interface Props {
  connections: ConnectionView[];
}

/**
 * 对话面板（W2）。
 * 关键实现点：
 * 1. 订阅一次 onStream，用 messageId 归位增量，避免多次订阅造成重复渲染；
 * 2. 流式期间输入框保持可用（知识卡片 004：流式 UI 预算），停止按钮随时可点；
 * 3. 卸载时取消订阅，避免窗口重载后回调堆积。
 */
export function ChatPanel({ connections }: Props): ReactElement {
  const [connectionId, setConnectionId] = useState<string>('');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
  const [toolLines, setToolLines] = useState<ToolLine[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!connectionId && connections.length > 0) {
      setConnectionId(connections[0]?.id ?? '');
    }
    if (connectionId && !connections.some((c) => c.id === connectionId)) {
      setConnectionId(connections[0]?.id ?? '');
    }
  }, [connections, connectionId]);

  useEffect(() => {
    const unsubscribe = window.jujia.onStream((event: StreamEvent) => {
      if (event.type === 'text_delta') {
        setBubbles((prev) =>
          prev.map((b) => (b.id === event.messageId ? { ...b, content: b.content + event.delta } : b)),
        );
        return;
      }
      if (event.type === 'tool_start') {
        setToolLines((prev) => [
          ...prev,
          { callId: event.callId, name: event.name, phase: 'running' },
        ]);
        return;
      }
      if (event.type === 'tool_end') {
        setToolLines((prev) =>
          prev.map((t) =>
            t.callId === event.callId
              ? { ...t, phase: 'done', ok: event.ok, summary: event.summary, durationMs: event.durationMs }
              : t,
          ),
        );
        return;
      }
      if (event.type === 'usage') {
        setUsage({ input: event.inputTokens, output: event.outputTokens });
        return;
      }
      if (event.type === 'error') {
        setBubbles((prev) =>
          prev.map((b) => (b.streaming ? { ...b, streaming: false, error: event.message } : b)),
        );
        setSending(false);
        return;
      }
      // done
      if (event.reason === 'tool_calls') {
        // 模型想调工具，但对话页还没接工具执行（W5）：必须说明，不能静默当作结束
        setBubbles((prev) =>
          prev.map((b) =>
            b.streaming
              ? {
                  ...b,
                  streaming: false,
                  error: '模型请求调用工具；当前对话页尚未启用工具执行（W5 起支持）。',
                }
              : b,
          ),
        );
      } else {
        setBubbles((prev) => prev.map((b) => (b.streaming ? { ...b, streaming: false } : b)));
      }
      setSending(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || !connectionId) return;

    const userBubble: Bubble = { id: `u-${Date.now()}`, role: 'user', content: text };
    setBubbles((prev) => [...prev, userBubble]);
    setInput('');
    setSending(true);
    setUsage(null);
    setToolLines([]);

    try {
      const res = await window.jujia.chatSend({
        connectionId,
        text,
        ...(sessionId ? { sessionId } : {}),
      });
      setSessionId(res.sessionId);
      setBubbles((prev) => [
        ...prev,
        { id: res.messageId, role: 'assistant', content: '', streaming: true },
      ]);
    } catch (err) {
      setSending(false);
      setBubbles((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: '',
          error: err instanceof Error ? err.message : String(err),
        },
      ]);
    }
  }

  async function stop(): Promise<void> {
    if (!sessionId) return;
    await window.jujia.chatStop(sessionId);
  }

  return (
    <div className="w2-chat">
      <div className="w2-chat-toolbar">
        <label>
          连接
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            {connections.length === 0 && <option value="">（请先在「连接」页创建）</option>}
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.model}
              </option>
            ))}
          </select>
        </label>
        {sessionId && <span className="p0-subtitle">会话 {sessionId.slice(0, 8)}</span>}
        {usage && (
          <span className="p0-subtitle">
            tokens: 入 {usage.input} / 出 {usage.output}
          </span>
        )}
      </div>

      <div className="w2-chat-scroll" ref={scrollerRef}>
        {bubbles.length === 0 && (
          <p className="p0-subtitle">还没有对话。选好连接，在下面输入第一句。</p>
        )}
        {toolLines.length > 0 && (
        <div className="w5-tools">
          {toolLines.map((t) => (
            <div key={t.callId} className={t.ok === false ? 'w5-tool w5-tool-bad' : 'w5-tool'}>
              <span className="w5-tool-icon">{t.phase === 'running' ? '◌' : t.ok ? '✓' : '✗'}</span>
              <code>{t.name}</code>
              {t.durationMs !== undefined && <span className="p0-subtitle">{t.durationMs}ms</span>}
              {t.summary && <span className="p0-subtitle">{t.summary.slice(0, 80)}</span>}
            </div>
          ))}
        </div>
      )}
      {bubbles.map((b) => (
          <div key={b.id} className={b.role === 'user' ? 'w2-bubble-user' : 'w2-bubble-agent'}>
            <div className="w2-bubble-role">{b.role === 'user' ? '我' : 'Agent'}</div>
            <div className="w2-bubble-body">
              {b.content || (b.streaming ? '…' : '')}
              {b.streaming && <span className="w2-caret" />}
              {b.error && <div className="p0-err">✗ {b.error}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="w2-chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="w2-actions">
          <button
            type="button"
            className="w2-btn-primary"
            disabled={!connectionId || input.trim() === '' || sending}
            onClick={() => void send()}
          >
            发送
          </button>
          <button type="button" className="w2-btn" disabled={!sending} onClick={() => void stop()}>
            停止
          </button>
        </div>
      </div>
    </div>
  );
}
