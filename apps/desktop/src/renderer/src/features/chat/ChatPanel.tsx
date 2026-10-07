import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  ChatSessionMeta,
  CompactStatusView,
  ConnectionView,
  PendingNoteItem,
  StreamEvent,
} from '@jujia/shared-ipc';
import { createDeltaBatcher, windowedSlice } from '@jujia/shared/stream-batcher';
import { belongsToSession } from './stream-routing';
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
  /**
   * 这个面板此刻可不可见（T22）。
   * 面板常驻之后，`display:none` 期间 `scrollTop` / `scrollHeight` 读不到 ——
   * 滚动位置实际会丢，所以切回来要按"原本贴底就贴底"补一次。
   */
  active?: boolean;
}

/**
 * 对话面板（W2）。
 * 关键实现点：
 * 1. 订阅一次 onStream，用 messageId 归位增量，避免多次订阅造成重复渲染；
 * 2. 流式期间输入框保持可用（知识卡片 004：流式 UI 预算），停止按钮随时可点；
 * 3. 卸载时取消订阅，避免窗口重载后回调堆积。
 */
export function ChatPanel({ connections, active = true }: Props): ReactElement {
  const [connectionId, setConnectionId] = useState<string>('');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  /**
   * 与 `sessionId` 同步，但**读得到当下值**：onStream 的回调只订阅一次（见下面的 effect），
   * 闭包里的 state 会永远停在第一次渲染那一份，用它筛事件就会把当前会话自己的事件也丢掉。
   */
  const sessionIdRef = useRef<string | undefined>(undefined);
  /** 这一轮"能继续，但有件事该知道"（目前唯一来源：磁盘历史没装回来，T6④） */
  const [historyHint, setHistoryHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
  const [toolLines, setToolLines] = useState<ToolLine[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  /** 长期记忆写入的进行中与回执（只由用户点「记住这一点」触发） */
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteHint, setNoteHint] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** delta 合批（纯逻辑在 @jujia/shared/stream-batcher，可单测与变异测试） */
  const batcherRef = useRef<ReturnType<typeof createDeltaBatcher<{ messageId: string; delta: string }>> | null>(null);
  /** 长会话窗口化：默认只渲染最近 N 条，避免上万个 DOM 节点拖垮滚动 */
  const [windowSize, setWindowSize] = useState(120);
  /**
   * 磁盘分页游标（6a 会话持久化）。
   * `loadedFrom` = 磁盘上还有多少条**没读进来**（也是下一次往前翻的 `before`）。
   * 渲染层的窗口化（上面的 windowSize）管"一次挂多少 DOM"，这里管"数据从盘上取了几页"，
   * 两层各解决一个问题：前者是浏览器卡顿，后者是内存与 IO 的规模上界。
   */
  const [loadedFrom, setLoadedFrom] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [saved, setSaved] = useState<ChatSessionMeta[]>([]);
  const [pickId, setPickId] = useState('');

  /**
   * 6b 的界面态。
   *
   * A（压缩）：`compactInfo` 是"该不该问一句"，`compactDraft` 是**预览**（还没落盘的那一份）。
   * B（结束记要点）：`pendingNotes` 是上次退出留下的待办账，`pendingDraft` 同样只是预览。
   * 两处的"预览"都刻意不写盘 —— 点存才走 apply。
   */
  const [compactInfo, setCompactInfo] = useState<CompactStatusView | null>(null);
  const [compactDraft, setCompactDraft] = useState<{
    summary: string;
    truncated: boolean;
    willCover: number;
  } | null>(null);
  const [compactBusy, setCompactBusy] = useState(false);
  const [compactHint, setCompactHint] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pendingNotes, setPendingNotes] = useState<PendingNoteItem[]>([]);
  const [pendingDraft, setPendingDraft] = useState<{ sessionId: string; text: string } | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingHint, setPendingHint] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
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
    batcherRef.current = createDeltaBatcher<{ messageId: string; delta: string }>((batch) => {
      setBubbles((prev) =>
        prev.map((b) => {
          let extra = '';
          for (const item of batch) if (item.messageId === b.id) extra += item.delta;
          return extra === '' ? b : { ...b, content: b.content + extra };
        }),
      );
    });

    const unsubscribe = window.jujia.onStream((event: StreamEvent) => {
      // **先筛会话**（外部审查 T5）：这条通道是全局广播。增量因为 messageId 对不上看起来"没事"，
      // 但 done / error / usage / tool_* 这四支不需要 messageId，切了会话照样把界面改错。
      if (!belongsToSession(event, sessionIdRef.current)) return;
      if (event.type === 'text_delta') {
        // delta 合批：流式期间每秒可能推几十次增量，每次都 setState 会造成高频重渲染。
        // 合批逻辑抽到 @jujia/shared（纯函数 + 可注入调度器），因此「合批被去掉」这类退化能被测出。
        batcherRef.current?.push({ messageId: event.messageId, delta: event.delta });
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
        /**
         * 说明（轨道回归计划 1 修 M7）：这里**曾经**写着"对话页尚未启用工具执行（W5 起支持）"，
         * 而 W5b 起工具执行早已打通 —— 那句话变成了对用户的能力误导。
         * 现在按事实写：正常流程下 Agent Loop 会自己执行工具并继续，
         * 走到这里说明循环**没有继续**（例如预算/上限到达），于是如实告知"还可以继续"。
         */
        setBubbles((prev) =>
          prev.map((b) =>
            b.streaming
              ? {
                  ...b,
                  streaming: false,
                  error: '本轮在工具调用处结束了（工具已执行）；你可以继续说"继续"让它接着往下做。',
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

  /**
   * 切回对话页时补一次滚动（T22 报备 §三 第一条）。
   * 常驻期间元素被 `hidden`（= `display:none`），布局不成立 → `scrollTop` / `scrollHeight` 读不到，
   * 所以回来时位置是真的丢了。口径与上面那条完全一致：**原本贴底才贴底，用户上滚过就不抢**。
   */
  useEffect(() => {
    if (!active || !stickToBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  /** 长列表窗口化（纯逻辑在 @jujia/shared）：只渲染末尾 N 条，避免上万个 DOM 节点拖垮滚动 */
  const windowed = windowedSlice(bubbles, windowSize);

  /** 选了连接就把它名下的历史会话列出来（磁盘事实，不看内存驻留） */
  useEffect(() => {
    if (connectionId === '') {
      setSaved([]);
      return;
    }
    let alive = true;
    void window.jujia
      .chatList()
      .then((list) => {
        if (alive) setSaved(list.filter((s) => s.connectionId === connectionId));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connectionId]);

  function toBubbles(messages: Array<{ role: string; content: string }>): Bubble[] {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m, i) => ({
        id: `h-${String(i)}-${m.role}`,
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }));
  }

  /**
   * 换一个会话看时**必须一起清掉**的"这一会话专属"状态。
   *
   * 为什么现在有这条：事件按会话筛之后（T5），上一个会话的 `done` 不再会落到当前界面上 ——
   * 那是修复的目的。但反过来，也没人替我们把 `sending` / `usage` 归零了。
   * 所以换会话的那一刻由我们自己清：**留下的只有这个会话自己的事实**。
   */
  function resetView(): void {
    setSending(false);
    setUsage(null);
    setToolLines([]);
    setHistoryHint(null);
    setNoteHint(null);
    setLastError(null);
  }

  /** 继续一个磁盘上的会话（6a 的"重启不丢对话"就落在这里） */
  async function resume(id: string): Promise<void> {
    const page = await window.jujia.chatHistory({ sessionId: id, limit: 120 });
    resetView();
    setBubbles(toBubbles(page.messages));
    selectSession(id);
    setPickId(id);
    setHistoryTotal(page.total);
    setLoadedFrom(page.hasMore);
  }

  /**
   * 往前翻：盘上还有没读进来的就先从盘读，读完了才放宽渲染窗口。
   * 顺序反了就等于"以为翻完了"其实只是没读 —— 两层各管各的上界，别互相顶替。
   */
  async function loadOlder(): Promise<void> {
    if (sessionId === undefined) {
      setWindowSize((w) => w + 200);
      return;
    }
    if (loadedFrom <= 0) {
      setWindowSize((w) => w + 200);
      return;
    }
    const before = loadedFrom;
    const page = await window.jujia.chatHistory({ sessionId, before, limit: 120 });
    setBubbles((prev) => [...toBubbles(page.messages), ...prev]);
    setHistoryTotal(page.total);
    setLoadedFrom(page.hasMore);
  }

  /** 四态判定：空 / 加载 / 错误 / 成功 */
  const viewState: 'empty' | 'loading' | 'error' | 'ready' =
    bubbles.length === 0 && sending
      ? 'loading'
      : bubbles.length === 0 && lastError !== null
        ? 'error'
        : bubbles.length === 0
          ? 'empty'
          : 'ready';

  /* ---------------- 6b：压缩（A）与「结束记要点」（B） ---------------- */

  /** 会话切换、或一轮跑完之后重新问一次状态（阈值判定只在主进程算，界面不复制规则） */
  useEffect(() => {
    setCompactDraft(null);
    setCompactHint(null);
    if (sessionId === undefined) {
      setCompactInfo(null);
      return;
    }
    if (sending) return;
    let cancelled = false;
    void window.jujia.chatCompactStatus(sessionId).then((s) => {
      if (!cancelled) setCompactInfo(s);
    }, () => {
      // 问不到状态不是错：只是这一轮不提示。下一轮结束还会再问，静默失败才是问题
      if (!cancelled) setCompactInfo(null);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, sending]);

  /** 上次退出攒下的待办账：开机问一次，用户说过「不再问」就永不再弹 */
  useEffect(() => {
    let cancelled = false;
    void window.jujia.chatPendingList().then((v) => {
      if (cancelled || v.neverAsk) return;
      setPendingNotes(v.items);
    }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function askCompact(): Promise<void> {
    if (sessionId === undefined) return;
    setCompactBusy(true);
    setCompactHint(null);
    try {
      const r = await window.jujia.chatCompactPreview(sessionId);
      if (!r.ok) {
        setCompactHint({ kind: 'err', text: r.error });
        return;
      }
      setCompactDraft({ summary: r.summary, truncated: r.truncated, willCover: r.willCover });
    } finally {
      setCompactBusy(false);
    }
  }

  /** 「先不存」：只把预览丢掉 —— 磁盘与水印从这一刻起也没被动过 */
  function discardCompact(): void {
    setCompactDraft(null);
    setCompactHint({ kind: 'ok', text: '没存。发给模型的上下文一点没变。' });
  }

  async function applyCompact(): Promise<void> {
    if (sessionId === undefined || compactDraft === null) return;
    setCompactBusy(true);
    try {
      const r = await window.jujia.chatCompactApply(sessionId, compactDraft.summary);
      setCompactDraft(null);
      setCompactHint(
        r.ok
          ? { kind: 'ok', text: `已压缩到第 ${String(r.compactedThrough)} 条，原始记录一字未删（在磁盘上可查）` }
          : { kind: 'err', text: r.error },
      );
      setCompactInfo(await window.jujia.chatCompactStatus(sessionId));
    } finally {
      setCompactBusy(false);
    }
  }

  async function endSessionAndRemember(): Promise<void> {
    if (sessionId === undefined) return;
    setPendingBusy(true);
    // 上一笔的回执不能留在原地：留着它，这一笔无论成败都像"已经办过了"
    setPendingHint(null);
    try {
      const r = await window.jujia.chatEnd(sessionId);
      if (!r.ok) {
        setPendingHint({ kind: 'err', text: r.error });
        return;
      }
      const list = await window.jujia.chatPendingList();
      setPendingNotes(list.items);
      setPendingHint({ kind: 'ok', text: '这个会话算结束了。要点先看着，看过再决定写不写进长期记忆。' });
    } finally {
      setPendingBusy(false);
    }
  }

  async function previewPendingNote(item: PendingNoteItem): Promise<void> {
    setPendingBusy(true);
    setPendingHint(null);
    try {
      const r = await window.jujia.chatPendingPreview(item.sessionId);
      if (!r.ok) {
        setPendingHint({ kind: 'err', text: r.error });
        return;
      }
      setPendingDraft({ sessionId: item.sessionId, text: r.text });
    } finally {
      setPendingBusy(false);
    }
  }

  async function resolvePendingNote(
    item: PendingNoteItem,
    action: 'remember' | 'skip' | 'never',
  ): Promise<void> {
    setPendingBusy(true);
    // 上一笔的回执不能留在这一次的动作上：那会让"没写进去"看起来像"写进去了"
    setPendingHint(null);
    try {
      const r = await window.jujia.chatPendingResolve(
        item.sessionId,
        action,
        pendingDraft?.sessionId === item.sessionId ? pendingDraft.text : '',
      );
      setPendingDraft(null);
      if (!r.ok) {
        setPendingHint({ kind: 'err', text: r.error });
        return;
      }
      const list = await window.jujia.chatPendingList();
      setPendingNotes(list.items);
      setPendingHint({
        kind: 'ok',
        text:
          action === 'remember'
            ? '要点已写进长期记忆（.jujia/NOTES.md，可在「文档」页签点「查看长期记忆」核对）'
            : action === 'never'
              ? '好，以后不再问这件事'
              : '这条没写进长期记忆',
      });
    } finally {
      setPendingBusy(false);
    }
  }

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
      setHistoryHint(null);
      const res = await window.jujia.chatSend({
        connectionId,
        text,
        ...(sessionId ? { sessionId } : {}),
      });
      selectSession(res.sessionId);
      setHistoryHint(res.warning);
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

  /** 换会话（续上 / 新建 / 用主进程给的 id）的唯一入口：状态与 ref 一起走，不给"只改一处"留机会 */
  function selectSession(id: string | undefined): void {
    sessionIdRef.current = id;
    setSessionId(id);
  }

  async function stop(): Promise<void> {
    if (!sessionId) return;
    await window.jujia.chatStop(sessionId);
  }

  /**
   * 把这条回答记进长期记忆 —— **唯一**的写入入口，由人显式点。
   * 走 `append_note` 工具（而不是另开一条"记忆通道"）：权限门、路径守卫、弹窗摘要与审计
   * 都已经在工具执行器里实现并测过，第二套口径迟早会漂。
   */
  async function remember(text: string): Promise<void> {
    setNoteBusy(true);
    setNoteHint(null);
    try {
      const result = await window.jujia.toolRun('append_note', { text: text.slice(0, 500) });
      setNoteHint({ kind: result.ok ? 'ok' : 'err', text: result.content });
    } catch (err) {
      setNoteHint({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setNoteBusy(false);
    }
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
        {saved.length > 0 && (
          <label>
            历史会话
            <select
              aria-label="继续会话"
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              <option value="">（选一个接着聊）</option>
              {saved.slice(0, 8).map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.title} · ${String(s.messageCount)} 条`}
                </option>
              ))}
            </select>
          </label>
        )}
        {pickId !== '' && pickId !== sessionId && (
          <button type="button" className="w2-btn" onClick={() => void resume(pickId)}>
            继续
          </button>
        )}
        {sessionId !== undefined && (
          <button
            type="button"
            className="w2-btn"
            onClick={() => {
              resetView();
              selectSession(undefined);
              setBubbles([]);
              setPickId('');
              setLoadedFrom(0);
              setHistoryTotal(0);
            }}
          >
            新会话
          </button>
        )}
        {sessionId && <span className="p0-subtitle">会话 {sessionId.slice(0, 8)}</span>}
        {historyTotal > 0 && (
          <span className="p0-subtitle">{`共 ${String(historyTotal)} 条（重启后仍在磁盘上）`}</span>
        )}
        {/*
          「已压缩至第 N 条」= 这一版摘要**覆盖了到哪一条**（报备 §五）。
          水印是落盘行号，所以这里说的"N 条"和上面"共 N 条"是同一个坐标系 —— 用户拿两个数能对上账。
        */}
        {compactInfo !== null && compactInfo.compactedThrough > 0 && (
          <span
            className="w2-chip"
            title={`早先 ${String(compactInfo.compactedThrough)} 条已折成摘要注入；原始记录共 ${String(
              compactInfo.totalMessages,
            )} 条，仍一字不删地存在磁盘上${compactInfo.summaryStoredAt === '' ? '' : `（摘要存于 ${new Date(
              compactInfo.summaryStoredAt,
            ).toLocaleString()}）`}`}
          >
            {`已压缩至第 ${String(compactInfo.compactedThrough)} 条`}
          </span>
        )}
        {sessionId !== undefined && (
          <button
            type="button"
            className="w2-btn"
            disabled={pendingBusy || sending}
            onClick={() => void endSessionAndRemember()}
          >
            结束并记要点
          </button>
        )}
        {usage && (
          <span className="p0-subtitle">
            tokens: 入 {usage.input} / 出 {usage.output}
          </span>
        )}
      </div>

      {/* 磁盘历史没装回来时的提示（T6④）：话要说完 —— 旧记录没动、这一轮是从空上下文继续 */}
      {historyHint !== null && (
        <p className="p0-err" role="alert">
          {historyHint}
        </p>
      )}

      {/*
        6b-A：阈值**只提示**（报备 §二 / 批复③）。
        这一条上没有任何写盘动作 —— 唯一的落盘入口是预览卡上的「就按这版存」。
      */}
      {compactInfo !== null && compactInfo.shouldPrompt && compactDraft === null && (
        <div className="p0-card" role="status">
          <p className="p0-warn">{compactInfo.reason}</p>
          <div className="w2-actions">
            <button
              type="button"
              className="w2-btn-primary"
              disabled={compactBusy || sending}
              onClick={() => void askCompact()}
            >
              {compactBusy ? '正在生成摘要…' : '压缩此会话'}
            </button>
          </div>
        </div>
      )}

      {/* 预览：落盘前必须过人的眼（批复④）。主进程这一步一个字节都不写 */}
      {compactDraft !== null && (
        <div className="p0-card" role="group" aria-label="压缩预览">
          <p className="p0-subtitle">
            {`这版摘要会顶替发给模型的早先原文（存到第 ${String(
              compactDraft.willCover,
            )} 条为止）。磁盘上的原始记录一字不删，现在还没写盘。`}
          </p>
          {compactDraft.truncated && <p className="p0-warn">摘要过长已截断</p>}
          <pre className="jj-pre">{compactDraft.summary}</pre>
          <div className="w2-actions">
            <button
              type="button"
              className="w2-btn-primary"
              disabled={compactBusy}
              onClick={() => void applyCompact()}
            >
              就按这版存
            </button>
            <button type="button" className="w2-btn" disabled={compactBusy} onClick={discardCompact}>
              先不存
            </button>
            <button
              type="button"
              className="w2-btn"
              disabled={compactBusy}
              onClick={() => void askCompact()}
            >
              {compactBusy ? '正在生成摘要…' : '重新生成一次'}
            </button>
          </div>
        </div>
      )}

      {compactHint !== null && (
        <p className={compactHint.kind === 'ok' ? 'jj-ok' : 'p0-err'} role="status">
          {compactHint.text}
        </p>
      )}

      {/*
        6b-B：上次退出攒下的"还没记要点"。退出当场不写盘也不调模型（报备 §四 / 批复④），
        补问时同样必须先预览 —— 「记」在看过内容之前是点不动的。
      */}
      {pendingNotes.length > 0 && (
        <div className="p0-card" role="group" aria-label="待记要点">
          <p className="p0-warn">{`有 ${String(
            pendingNotes.length,
          )} 个会话结束了还没记要点。要不要写进长期记忆，先看一眼要写什么。`}</p>
          {pendingNotes.map((item) => (
            <div key={item.sessionId}>
              <span className="p0-subtitle">{`《${item.title}》`}</span>
              {pendingDraft?.sessionId === item.sessionId && (
                <>
                  <p className="p0-subtitle">
                    这一行会追加进 .jujia/NOTES.md，并在之后的每次会话里注入给模型：
                  </p>
                  <pre className="jj-pre">{pendingDraft.text}</pre>
                </>
              )}
              <div className="w2-actions">
                <button
                  type="button"
                  className="w2-btn"
                  disabled={pendingBusy}
                  onClick={() => void previewPendingNote(item)}
                >
                  {pendingBusy ? '正在生成要点…' : '看摘要再决定'}
                </button>
                <button
                  type="button"
                  className="w2-btn-primary"
                  disabled={pendingBusy || pendingDraft?.sessionId !== item.sessionId}
                  onClick={() => void resolvePendingNote(item, 'remember')}
                >
                  记
                </button>
                <button
                  type="button"
                  className="w2-btn"
                  disabled={pendingBusy}
                  onClick={() => void resolvePendingNote(item, 'skip')}
                >
                  不记
                </button>
                <button
                  type="button"
                  className="w2-btn"
                  disabled={pendingBusy}
                  onClick={() => void resolvePendingNote(item, 'never')}
                >
                  不再问
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingHint !== null && (
        <p className={pendingHint.kind === 'ok' ? 'jj-ok' : 'p0-err'} role="status">
          {pendingHint.text}
        </p>
      )}

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
      {(loadedFrom > 0 || windowed.hiddenCount > 0) && (
        <button
          type="button"
          className="jj-btn jj-btn-quiet jj-transition"
          onClick={() => void loadOlder()}
        >
          {loadedFrom > 0
            ? `从磁盘再读 ${String(Math.min(120, loadedFrom))} 条`
            : `显示更早的 ${windowed.hiddenCount} 条`}
        </button>
      )}
      {windowed.visible.map((b) => (
          <div key={b.id} className={b.role === 'user' ? 'w2-bubble-user' : 'w2-bubble-agent'}>
            <div className="w2-bubble-role">{b.role === 'user' ? '我' : 'Agent'}</div>
            <div>
              {b.content || (b.streaming ? '…' : '')}
              {b.streaming && <span className="w2-caret" />}
              {b.error && <div className="p0-err">✗ {b.error}</div>}
              {/*
                长期记忆的**唯一写入口**：只有人按下这个按钮才会写。
                刻意不做"每轮自动记一条" —— 那会把聊天流水灌进长期记忆（卡片 015 叫它 context sludge）。
                点它之后走的是 `append_note` 工具：写类操作照样要过权限门，路径守卫在写之前跑。
              */}
              {b.role === 'assistant' && !b.streaming && b.error === undefined && b.content !== '' && (
                <div>
                  <button
                    type="button"
                    className="w2-btn"
                    disabled={noteBusy}
                    onClick={() => void remember(b.content)}
                  >
                    记住这一点
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {noteHint !== null && (
        <p className={noteHint.kind === 'ok' ? 'jj-ok' : 'p0-err'} role="status">
          {noteHint.text}
        </p>
      )}

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
