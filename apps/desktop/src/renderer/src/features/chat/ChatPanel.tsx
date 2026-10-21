import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { RESUME_USER_TEXT } from '@jujia/shared-ipc';
import type {
  ChatSessionMeta,
  ConnectionView,
  PendingNoteItem,
  StreamEvent,
} from '@jujia/shared-ipc';
import { createDeltaBatcher, windowedSlice } from '@jujia/shared/stream-batcher';
import { ChatComposer } from './ChatComposer';
import { olderPageNotice, toHistoryBubbles } from './history-bubbles';
import { truncationNotice } from './done-notice';
import { belongsToSession } from './stream-routing';
import { TaskCard } from './TaskCard';
import { ToolCard } from './ToolCard';
import { useAttachments } from './use-attachments';
import { useCompact } from './use-compact';
import { useTaskCard } from './use-task-card';
import { IconPencil, IconTriangleAlert, IconX } from '../../ui/icons';

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 仍在流式接收中 */
  streaming?: boolean;
  /** 出错信息（若有） */
  error?: string;
  /**
   * 不是错误、但用户必须看见的一句话（目前只有"回答被上游截断"，T26）。
   * 刻意不与 `error` 共用一格：那一条前面挂着失败图标，把"不完整"显示成"失败"是另一种误导。
   */
  notice?: string;
  /**
   * 这条消息带了几张图（M11 批一）。图片字节**不落盘、发送后也不留在界面**，
   * 这个数字是本地唯一的痕迹 —— 界面上以「图片未保留 ×N」如实显示。
   */
  imageCount?: number | undefined;
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
  /**
   * 实时输出的**尾部快照**（R8.7）。只在本次运行期间存在于内存里 ——
   * 会话历史与喂给模型的都是跑完之后的 `summary`，半截输出不进任何一处的盘。
   */
  tail?: string;
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
  /**
   * 往前翻这一页取到了什么（外部审查 T33 的后半）。
   *
   * 刻意**不**复用 `historyHint`：那一条说的是"磁盘历史没装回来"，这一条说的是
   * "这一页没有可显示的对话"，两个事实轮流出现 —— 共用一行就会互相冲掉，
   * 而"翻不动"这件事一旦没话，界面上看起来就和按钮坏了相同。
   */
  const [pageHint, setPageHint] = useState<string | null>(null);
  /**
   * 「谁在流」按**会话**记账（T40-② 的正确修法 · R23）：
   * 切走再切回要能**续见、能停** —— 旧模型是一个布尔，切会话时被 resetView 清零，
   * 在飞的那条从此"看不见也停不掉"（R22 曾试硬拦，被 e2e [26] 否决：切换中流是设计能力）。
   * 集合的增删**全由事件驱动**（send 起、done/error 收；任何会话的都收得到 —— 通道是全局广播），
   * 不去问主进程；`sendArmed` 只覆盖"点击 → 主进程回 sessionId"之间那段窗口（防连点）。
   */
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sendArmed, setSendArmed] = useState(false);
  const sending = sendArmed || (sessionId !== undefined && streamingIds.has(sessionId));
  /** T40：翻页在飞保护（连点会重复前插、同页重复 key） */
  const [olderBusy, setOlderBusy] = useState(false);
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
   * 待发图片（M11 批一）。状态与准入行为都在 `useAttachments`（本文件行数触顶后
   * 按"自己一段完整生命周期"切出去的那一块）—— 这里只消费它。
   */
  const tray = useAttachments();

  /**
   * 被打断的任务卡片（M17 批一）。取数与续跑会话在 `useTaskCard`；
   * 续跑成功之后界面做的事与 `send()` 同形（用户气泡 + 等待流式回答）——
   * 文案常量来自契约（单一出处），这里不自己拼句子。
   */
  const task = useTaskCard(sessionId, sending, (r) => {
    setBubbles((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: RESUME_USER_TEXT },
      { id: r.messageId ?? `a-${Date.now()}`, role: 'assistant', content: '', streaming: true },
    ]);
    if (r.sessionId !== null) selectSession(r.sessionId);
    // 与 send() 同形：**起流记账**（续跑同样归"按会话的流中状态"管，直到它自己的 done/error）——
    // 旧写法直接置"发送位"（单一布尔），切走再回来就找不到这条流了
    const sid = r.sessionId ?? sessionId;
    if (sid !== undefined) {
      setStreamingIds((prev) => {
        if (prev.has(sid)) return prev;
        const next = new Set(prev);
        next.add(sid);
        return next;
      });
    }
    setHistoryHint(r.warning);
    setUsage(null);
    setToolLines([]);
  });

  /**
   * 6b 的界面态。
   *
   * A（压缩）：`compactInfo` 是"该不该问一句"，`compactDraft` 是**预览**（还没落盘的那一份）。
   * B（结束记要点）：`pendingNotes` 是上次退出留下的待办账，`pendingDraft` 同样只是预览。
   * 两处的"预览"都刻意不写盘 —— 点存才走 apply。
   */
  // 压缩簇（预览 → 存 / 不存 → 刷新 + 会话切换时重问）整体在 useCompact（加固15 · 行数触顶拆出）
  const { compactInfo, compactDraft, compactBusy, compactHint, askCompact, discardCompact, applyCompact } =
    useCompact(sessionId, sending);
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
      // 先把「谁在流」扣掉（**任何会话**都扣：切走的会话在别处跑完时，我们也收得到它的 done/error）——
      // 这是"切回能续见、能停"的记账来源；必须在会话闸门**之前**（闸门会把别人的事件丢掉）。
      // 注：这里**只动记账集合**，一个视图 setter 都不许出现（旁路的形状 = 某类事件在闸门前改界面，
      // stream-routing 的接线锁钉这条）；sendArmed 不在这里清 —— 它只覆盖"点击→回执"窗口，
      // 流事件不可能早于回执到达，清它反而是跨会话的越权。
      if (event.type === 'done' || event.type === 'error') {
        setStreamingIds((prev) => {
          if (!prev.has(event.sessionId)) return prev;
          const next = new Set(prev);
          next.delete(event.sessionId);
          return next;
        });
      }
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
      if (event.type === 'tool_output') {
        // 整段替换，不做拼接：主进程发来的就是"截至此刻的尾部"，
        // 因此切走页签期间错过的块不会真丢（回来那一份仍是最新的）
        setToolLines((prev) =>
          prev.map((t) => (t.callId === event.callId ? { ...t, tail: event.tail } : t)),
        );
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
        return;
      }
      // done
      // 被上游截断要说得出来（T26）：不说，半截回答看起来就是"模型答完了"
      const truncation = truncationNotice(event.reason);
      /**
       * T58（2026-10-15）：这里**曾经**有一条 `event.reason === 'tool_calls'` 的活分支
       * （"本轮在工具调用处结束了……"）。它永远不会执行 —— 主进程的 `resolved` 从不赋这个值，
       * Agent Loop 自己执行完工具就继续，不会把它当成一轮的结束原因。
       * 契约里那个成员是 provider 层的词汇漏进了 IPC 层。删掉分支 + 收紧枚举之后，
       * 界面这张说明表改成穷举 `Record`（见 done-notice.ts）：将来真加一个结束原因，
       * **不补文案就编译不过**，而不是再多一条读不到的分支。
       */
      setBubbles((prev) =>
        prev.map((b) =>
          b.streaming
            ? { ...b, streaming: false, ...(truncation === null ? {} : { notice: truncation }) }
            : b,
        ),
      );
      if (event.notice !== null) {
        // R25：落盘失败要说在明处（旧行为只进 main 控制台）——
        // 这一条不是"回答有问题"，是"这段不会被记住"
        setHistoryHint(event.notice);
      }
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

  /**
   * 换一个会话看时**必须一起清掉**的"这一会话专属"状态。
   *
   * 为什么现在有这条：事件按会话筛之后（T5），上一个会话的 `done` 不再会落到当前界面上 ——
   * 那是修复的目的。但反过来，也没人替我们把 `sending` / `usage` 归零了。
   * 所以换会话的那一刻由我们自己清：**留下的只有这个会话自己的事实**。
   */
  function resetView(): void {
    // 注意：**不再清 sending** —— "谁在流"按会话记在 `streamingIds` 里，切回该会话时
    // 由它恢复"发送中/可停"（T40-② 的正确修法 · R23）。这里只清"这一会话视图专属"的状态。
    setUsage(null);
    setToolLines([]);
    setHistoryHint(null);
    setPageHint(null);
    setNoteHint(null);
    setLastError(null);
    // 待发图片是"这一条消息"的，不是"这个会话"的 —— 换会话就清掉，免得夹带到别的对话里
    tray.clear();
  }

  /** 继续一个磁盘上的会话（6a 的"重启不丢对话"就落在这里） */
  async function resume(id: string): Promise<void> {
    // 注：这里**刻意不拦**"流中切会话"——切换中流是既有设计能力（e2e [26] 的隔离断言正是靠它），
    // 硬拦会把它拆掉（R22 首版试过，被 e2e 当堂否决）。"切回能续见、能停"的正确修法
    // （按会话的流中状态）已重排 R23（见 review 079 与 TRACK-ROADMAP §6.2）。
    try {
      const page = await window.jujia.chatHistory({ sessionId: id, limit: 120 });
      resetView();
      setBubbles(toHistoryBubbles(page.messages, page.hasMore));
      selectSession(id);
      setPickId(id);
      setHistoryTotal(page.total);
      setLoadedFrom(page.hasMore);
    } catch (err) {
      // T40：读历史失败要说话（旧写法 void 出去 = "点了没反应"）
      setHistoryHint(`读历史失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 往前翻：盘上还有没读进来的就先从盘读，读完了才放宽渲染窗口。
   * 顺序反了就等于"以为翻完了"其实只是没读 —— 两层各管各的上界，别互相顶替。
   */
  async function loadOlder(): Promise<void> {
    // T40：在飞保护 —— 连点会重复前插，同页出现重复 key（h-<offset+i>-<role> 撞车）。
    if (olderBusy) return;
    if (sessionId === undefined) {
      setWindowSize((w) => w + 200);
      return;
    }
    if (loadedFrom <= 0) {
      setWindowSize((w) => w + 200);
      return;
    }
    setOlderBusy(true);
    try {
      const before = loadedFrom;
      const page = await window.jujia.chatHistory({ sessionId, before, limit: 120 });
      const older = toHistoryBubbles(page.messages, page.hasMore);
      setBubbles((prev) => [...older, ...prev]);
      setHistoryTotal(page.total);
      setLoadedFrom(page.hasMore);
      // 取到了消息却一条气泡都没多 = 界面看起来"点了没反应"，这句话必须由我们说出来（T33）
      setPageHint(olderPageNotice({ fetched: page.messages.length, bubbles: older.length, hasMore: page.hasMore }));
    } catch (err) {
      // T40：读失败要说话（旧写法 void 出去 = "点了没反应"）
      setPageHint(`读更早的消息失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOlderBusy(false);
    }
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

  /** 加图提示里点名"发给谁"：隐私表述要落到具体连接，不能只说"服务商" */
  const connectionName = connections.find((c) => c.id === connectionId)?.name ?? '当前连接';

  /* ---------------- 6b：「结束记要点」（B） ---------------- */

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
    const images = tray.current();
    if ((text === '' && images.length === 0) || !connectionId) return;
    // T40：流式中不许重入（回车/连点都走这里）—— 主进程会拒"正在生成中"，而 catch 会把
    // sending 关掉：停止按钮失效 + 幽灵气泡两件都发生过。守卫放在动任何界面状态之前。
    if (sending) return;

    const userBubble: Bubble = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      ...(images.length > 0 ? { imageCount: images.length } : {}),
    };
    setBubbles((prev) => [...prev, userBubble]);
    setInput('');
    // 附件随发送立刻从待发清单拿掉：本地从不保留副本，失败后要重新添加 ——
    // 保留它会让"发送失败"旁边还挂着 4 张图，看起来像"这些已经发出去了"
    tray.clear();
    setSendArmed(true);
    setUsage(null);
    setToolLines([]);

    try {
      setHistoryHint(null);
      const res = await window.jujia.chatSend({
        connectionId,
        text,
        ...(sessionId ? { sessionId } : {}),
        ...(images.length > 0
          ? { images: images.map((img) => ({ name: img.name, dataBase64: img.dataBase64 })) }
          : {}),
      });
      selectSession(res.sessionId);
      // 起流记账：本会话进 `streamingIds`（解 armed 之后由它维持"发送中"），直到它的 done/error
      setStreamingIds((prev) => {
        if (prev.has(res.sessionId)) return prev;
        const next = new Set(prev);
        next.add(res.sessionId);
        return next;
      });
      setSendArmed(false);
      setHistoryHint(res.warning);
      setBubbles((prev) => [
        ...prev,
        { id: res.messageId, role: 'assistant', content: '', streaming: true },
      ]);
    } catch (err) {
      setSendArmed(false);
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
    try {
      await window.jujia.chatStop(sessionId);
    } catch (err) {
      // T40：失败要说话（旧写法 void 出去 = "点了没反应"）
      setHistoryHint(`停止失败：${err instanceof Error ? err.message : String(err)}`);
    }
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
        {sessionId && <span className="w2-chat-meta">会话 {sessionId.slice(0, 8)}</span>}
        {historyTotal > 0 && (
          <span className="w2-chat-meta">{`共 ${String(historyTotal)} 条（重启后仍在磁盘上）`}</span>
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
          <span className="w2-chat-meta">
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

      {/* 往前翻这一页取到了什么（T33）：没有这一行，翻到全是工具输出的那一页就等于"按钮没反应" */}
      {pageHint !== null && (
        <p className="p0-subtitle" role="status">
          {pageHint}
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

      {/* M17 批一：被打断的任务（主进程读时判定的产物；界面只显示它给的实话） */}
      {task.card !== null && (
        <TaskCard
          card={task.card}
          busy={task.busy}
          sending={sending}
          onResume={() => void task.resume()}
          onDismiss={() => void task.dismiss()}
        />
      )}
      {task.hint !== null && (
        <p className={task.hint.kind === 'ok' ? 'jj-ok' : 'p0-err'} role="status">
          {task.hint.text}
        </p>
      )}

      <div className="w2-chat-scroll" ref={scrollerRef}>
        {viewState === 'empty' && (
          <div className="jj-state jj-enter">
            <span className="jj-state-icon" aria-hidden="true">
              <IconPencil size={22} />
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
              <IconTriangleAlert size={22} />
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
          disabled={olderBusy}
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
              {b.error && (
                <div className="p0-err">
                  <IconX /> {b.error}
                </div>
              )}
              {/* 被截断的回答挂在这里，不挂成失败图标（T26）：那是"不完整"，不是"失败" */}
              {b.notice && <div className="p0-warn">{b.notice}</div>}
              {/*
                带图消息的本地痕迹（M11 批一）：图片字节没有任何本地副本，
                所以这一行不是"占位图"，而是**全部事实**。措辞是「未保留」不是「已过期」——
                过期暗示还能再取，而真相是本机从来没留过。
              */}
              {b.imageCount !== undefined && b.imageCount > 0 && (
                <div className="w2-img-marker">{`[图片未保留 ×${String(b.imageCount)}]`}</div>
              )}
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

      <ChatComposer
        input={input}
        attached={tray.attached}
        attachBusy={tray.attachBusy}
        attachHint={tray.attachHint}
        connectionName={connectionName}
        sending={sending}
        hasConnection={connectionId !== ''}
        onInput={setInput}
        onPickImages={() => void tray.pickImages()}
        onFiles={(files) => void tray.prepareDroppedFiles(files)}
        onRemoveImage={tray.removeAttached}
        onSend={() => void send()}
        onStop={() => void stop()}
      />
    </div>
  );
}
