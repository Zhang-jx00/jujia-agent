import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ConnectionView, StreamEvent } from '@jujia/shared-ipc';
import { ToolCard } from './ToolCard';

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 仍在流式接收中 */
  streaming?: boolean;
  /** 出错信息（若有） */
  error?: string;
}

/** 工具卡数据（L0–L2 三级信息密度，见 ToolCard.tsx） */
interface ToolLine {
  callId: string;
  name: string;
  phase: 'running' | 'done';
  ok?: boolean;
  summary?: string;
  durationMs?: number;
  argumentsText?: string;
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
  const [lastError, setLastError] = useState<string | null>(null);
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
          {
            callId: event.callId,
            name: event.name,
            phase: 'running',
            argumentsText: event.argumentsText,
          },
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
        setLastError(event.message);
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

  /**
   * 自动滚动：两处细节优化
   * 1. 用 requestAnimationFrame 合并——流式期间气泡每帧都可能更新，
   *    直接同步设置 scrollTop 会在每帧触发布局读取，属于典型的布局抖动；
   * 2. **用户主动上滚后不再抢滚动条**（这是最容易被忽略的体验问题：
   *    用户想回看上文，却被流式输出不断拽回底部）。
   */
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 48;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [bubbles, toolLines]);

  /** 四态判定：空 / 加载 / 错误 / 成功 */
  const viewState: 'empty' | 'loading' | 'error' | 'ready' =
    bubbles.length === 0 && sending
      ? 'loading'
      : bubbles.length === 0 && lastError !== null
        ? 'error'
        : bubbles.length === 0
          ? 'empty'
          : 'ready';

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
      const message = err instanceof Error ? err.message : String(err);
      // 发送失败：空态时用整页错误态（带重试指引），非空态时贴在气泡上
      setLastError(message);
      setBubbles((prev) => {
        if (prev.length === 0) return prev;
        return [
          ...prev,
          { id: `e-${Date.now()}`, role: 'assistant', content: '', error: message },
        ];
      });
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
        {viewState === 'empty' && (
          <div className="jj-state jj-enter">
            <span className="jj-state-icon" aria-hidden="true">
              ✎
            </span>
            <p>还没有对话。选好连接，在下面输入第一句。</p>
            <p className="p0-subtitle">提示：Agent 在改动文件前会弹出确认，你可以拒绝或改参数。</p>
          </div>
        )}
        {viewState === 'loading' && (
          <div className="jj-skeleton" aria-live="polite" aria-busy="true">
            <span className="p0-subtitle">正在等待模型响应…</span>
            <div className="jj-skeleton-line" />
            <div className="jj-skeleton-line" />
            <div className="jj-skeleton-line" />
          </div>
        )}
        {viewState === 'error' && (
          <div className="jj-state jj-enter">
            <span className="jj-state-icon" aria-hidden="true">
              ⚠
            </span>
            <p className="p0-err">{lastError}</p>
            <button type="button" className="jj-btn jj-transition jj-pressable" onClick={() => setLastError(null)}>
              知道了
            </button>
          </div>
        )}
        {toolLines.length > 0 && (
        <div className="w5-tools">
          {toolLines.map((t) => (
            <ToolCard key={t.callId} data={t} />
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
