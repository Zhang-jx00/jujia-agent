import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * 内置终端（W9b · T23 修的是它的会话生命周期）。
 *
 * 会话的生命周期归**主进程**（`terminal-service.ts`）：它属于当前工作区，不属于这个页面实例。
 * 所以这里三条纪律是刻意的，改动前先读理由：
 * - **卸载不杀会话**：以前在 clean-up 里 `terminalKill`，等于"切页签 = 关掉终端"。
 *   现在只销毁视图；会话要么由用户点「结束会话」结束，要么随应用退出被回收。
 * - **回来先问再接**：挂载时查 `terminalStatus`。跳过这一步就会走到「启动终端」上去，
 *   而每次都启动正是"同一个工作区攒出两个 PTY、前一个渲染层已经叫不出名字"的起点。
 * - **不做乐观 UI**：审批没通过就不显示"已连接"；接回到的会话被如实标为"接回"，
 *   不假装是这次新起的。
 *
 * 输出补齐（`seq` 那段）：切走期间主进程继续留一段有界的输出尾部，回来时补回视图。
 * "取快照"与"开始订阅"之间必然有一段间隙 —— 靠序号过滤，间隙里的块既不会重复显示也不会丢。
 */

interface TerminalPanelProps {
  /** 当前工作区根目录；未选择工作区时不允许开终端 */
  workspaceRoot: string | null;
}

/** 快照还没到之前先到达的输出块（窗口只有一个 IPC 来回，但仍要有界） */
interface PendingChunk {
  sessionId: string;
  chunk: string;
  seq: number;
}

const PENDING_CAP = 64;

/** 补回的输出与实时输出之间的分界（没有它，用户看不出哪段是"接回来"的） */
const TAIL_HEADER = (chars: number): string =>
  `\x1b[2m[接回上次仍在运行的会话 · 以下为保留的输出尾部（最新 ${String(chars)} 字符）]\x1b[0m\r\n`;

export function TerminalPanel({ workspaceRoot }: TerminalPanelProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  /** 已经写进视图的最后一批输出序号；`null` = 快照还没到，先来的一律先攒着 */
  const seqFloorRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingChunk[]>([]);
  const droppedRef = useRef(0);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error' | 'exited'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [limits, setLimits] = useState<{ liveCount: number; maxSessions: number } | null>(null);

  /** 建（或复用）这个页面实例的 xterm 视图。视图可以重建，会话不行 —— 两者分开管 */
  const ensureTerm = useCallback((): Terminal | null => {
    const host = hostRef.current;
    if (!host) return null;
    if (termRef.current !== null) return termRef.current;
    const term = new Terminal({
      // 与主进程 pty.spawn 的 name 保持一致，才能有 256 色
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#101010', foreground: '#f5f5f5' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.onData((data) => {
      const id = sessionRef.current;
      if (!id) return;
      // 写入失败只有一种可能：会话已经不在了（进程自己退出、而我们没订阅到退出事件）。
      // 必须在这里说出来，否则界面会停在"运行中"，用户敲的字一个都不显示。
      void window.jujia
        .terminalInput(id, data)
        .then((ok) => {
          if (ok) return;
          sessionRef.current = null;
          setStatus('exited');
          setMessage('这个会话已经结束（进程不在了）。需要时请重新启动。');
        })
        .catch(() => undefined);
    });
    termRef.current = term;
    fitRef.current = fit;
    return term;
  }, []);

  /** 接回一个会话：写清分界 → 补回输出尾部 → 放开序号闸门 → 把间隙里的块补上 */
  const attach = useCallback(
    (snapshot: { sessionId: string; tail: string; seq: number }): void => {
      const term = ensureTerm();
      if (!term) return;
      sessionRef.current = snapshot.sessionId;
      if (snapshot.tail !== '') {
        term.write(TAIL_HEADER(snapshot.tail.length));
        term.write(snapshot.tail);
      }
      seqFloorRef.current = snapshot.seq;
      const held = pendingRef.current;
      pendingRef.current = [];
      for (const ev of held) {
        if (ev.sessionId !== snapshot.sessionId || ev.seq <= snapshot.seq) continue;
        term.write(ev.chunk);
      }
      if (droppedRef.current > 0) {
        term.write(`\x1b[2m[接回期间的输出过长，中间省略了 ${String(droppedRef.current)} 段]\x1b[0m\r\n`);
        droppedRef.current = 0;
      }
      setStatus('running');
      term.focus();
    },
    [ensureTerm],
  );

  /** 没有会话可接回时也要开闸：否则快照之后的输出会被一直攒着看不见 */
  const releasePending = useCallback((): void => {
    seqFloorRef.current = 0;
    pendingRef.current = [];
    droppedRef.current = 0;
  }, []);

  // ---- 订阅终端事件（挂载一次，避免重复订阅导致输出重复）----
  // 顺序不能反：**先订阅，再去问快照**。反过来的话间隙里到达的输出
  // 既不在快照里、也没人收 —— 那就是"接回来却发现中间少了一段"。
  useEffect(() => {
    const unsubscribe = window.jujia.onTerminalStream((event) => {
      if (event.type === 'data') {
        if (seqFloorRef.current === null) {
          if (pendingRef.current.length < PENDING_CAP) {
            pendingRef.current.push({ sessionId: event.sessionId, chunk: event.chunk, seq: event.seq });
          } else {
            droppedRef.current += 1;
          }
          return;
        }
        if (event.sessionId !== sessionRef.current) return;
        if (event.seq <= seqFloorRef.current) return; // 已经在补回的尾部里
        seqFloorRef.current = event.seq;
        termRef.current?.write(event.chunk);
        return;
      }
      if (event.sessionId !== sessionRef.current) return;
      termRef.current?.write(`\r\n\x1b[2m[进程已退出，退出码 ${event.exitCode}]\x1b[0m\r\n`);
      sessionRef.current = null;
      setStatus('exited');
    });
    return unsubscribe;
  }, []);

  // ---- 卸载时只销毁视图：**不杀会话**（T23 的核心）----
  useEffect(() => {
    return () => {
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
      seqFloorRef.current = null;
      pendingRef.current = [];
      droppedRef.current = 0;
    };
  }, []);

  // ---- 挂载/换工作区时先问一次状态，有会话就接回 ----
  const restore = useCallback(async (): Promise<void> => {
    if (workspaceRoot === null) {
      releasePending();
      setStatus('idle');
      return;
    }
    try {
      const result = await window.jujia.terminalStatus(workspaceRoot);
      setLimits({ liveCount: result.liveCount, maxSessions: result.maxSessions });
      if (result.session !== null) {
        attach(result.session);
        setMessage('已接回本工作区仍在运行的终端会话（切页签不会结束它）。');
        return;
      }
      releasePending();
      if (result.exited !== null) {
        // 进程是在我们看不见的时候退的 —— 不说，界面显示"未启动"会让人以为是切页签弄丢的
        setStatus('exited');
        setMessage(result.exited.notice);
        return;
      }
      setStatus('idle');
    } catch (err) {
      releasePending();
      setStatus('idle');
      setMessage(`没问到终端会话的状态：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [attach, releasePending, workspaceRoot]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const start = useCallback(async (): Promise<void> => {
    if (workspaceRoot === null) {
      setMessage('请先在工作区选择目录，再开终端（终端只能开在工作区内）');
      setStatus('error');
      return;
    }
    setStatus('starting');
    setMessage('等待审批…');

    const size = { cols: termRef.current?.cols ?? 80, rows: termRef.current?.rows ?? 24 };
    const result = await window.jujia.terminalStart({
      workspaceRoot,
      cols: size.cols,
      rows: size.rows,
    });

    if (!result.ok) {
      // 如实展示被拒/被限的原因，不伪装成"已连接"
      setStatus('error');
      setMessage(result.error);
      return;
    }
    if (result.adopted) {
      // 与点按钮之前那次查询之间的竞态：这里已经有会话了，别新起，照原路接回
      const snapshot = await window.jujia.terminalStatus(workspaceRoot);
      if (snapshot.session !== null) {
        attach(snapshot.session);
        setMessage('本工作区已有一个仍在运行的会话，已接回（没有新起进程，因此没有再要一次审批）。');
        return;
      }
    }
    ensureTerm();
    sessionRef.current = result.sessionId;
    seqFloorRef.current = 0;
    setStatus('running');
    setMessage(null);
    termRef.current?.focus();
  }, [attach, ensureTerm, workspaceRoot]);

  // ---- 尺寸自适应：把新尺寸回传主进程（否则全屏 TUI 会错行）----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      // 用 rAF 合并：resize 事件可能连续触发，逐次 fit 会造成布局抖动
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const term = termRef.current;
        const fit = fitRef.current;
        if (!term || !fit) return;
        try {
          fit.fit();
        } catch {
          return; // 容器隐藏时 fit 会失败，属正常
        }
        const id = sessionRef.current;
        if (id) void window.jujia.terminalResize(id, term.cols, term.rows).catch(() => undefined);
      });
    });
    ro.observe(host);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <section className="jj-terminal">
      <header className="jj-terminal-head">
        <strong>终端</strong>
        <span className="jj-muted">
          {status === 'idle' && '未启动'}
          {status === 'starting' && '等待审批…'}
          {status === 'running' && '运行中'}
          {status === 'exited' && '会话已结束'}
          {status === 'error' && '未启动'}
        </span>
        <button
          type="button"
          className="jj-btn jj-transition jj-pressable"
          onClick={() => void start()}
          disabled={status === 'starting' || status === 'running'}
        >
          {status === 'running' ? '已连接' : '启动终端（新会话需审批）'}
        </button>
        <button
          type="button"
          className="jj-btn jj-transition"
          disabled={status !== 'running'}
          onClick={() => {
            const id = sessionRef.current;
            if (!id) return;
            // T40：不在"还没成功"时就宣布结果 —— 旧写法把失败吞掉（catch(() => undefined)）
            // 仍然把界面切成"已结束"：用户下次回来才发现进程还在。
            window.jujia
              .terminalKill(id)
              .then(() => {
                // 手工关闭：会话唯一的界面出口（另一个是进程自己退出）
                sessionRef.current = null;
                setStatus('exited');
                setMessage('会话已由你结束。需要时请重新启动（新会话要你确认）。');
              })
              .catch((err: unknown) => {
                setMessage(
                  `结束会话失败：${err instanceof Error ? err.message : String(err)} —— 会话可能还在运行，可重试`,
                );
              });
          }}
        >
          结束会话
        </button>
      </header>

      {message && <p className={status === 'error' ? 'p0-err' : 'p0-subtitle'}>{message}</p>}

      <p className="p0-subtitle">
        终端可执行任意命令，因此<strong>新建会话要你确认</strong>（属高副作用能力）。
        <strong>切走页签不会结束会话</strong>：进程继续跑，回到本页会接回同一个会话
        （本工作区同时只保留一个，不会越切越多）。会话只在你点「结束会话」或应用退出时才结束。
        {limits !== null && ` 当前共用 ${String(limits.liveCount)} / ${String(limits.maxSessions)} 个会话。`}
      </p>

      <div className="jj-terminal-host" ref={hostRef} />
    </section>
  );
}
