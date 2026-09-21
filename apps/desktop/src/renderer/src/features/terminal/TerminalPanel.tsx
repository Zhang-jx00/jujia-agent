import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * 内置终端（W9b）。
 *
 * 关键设计：
 * - **每次新建会话都要过权限门**（终端能执行任意命令，归 `exec` 类）。
 *   渲染层只负责发起请求；被拒 / 超时由主进程如实返回原因。
 * - **不做乐观 UI**：审批没通过就不显示"已连接"，避免让人以为终端开了。
 * - 卸载 / 切页面时**销毁 xterm 实例并杀掉 PTY**，否则会留下僵尸子进程。
 * - 尺寸变化用 ResizeObserver + FitAddon 自适应，并把新尺寸回传主进程（否则 TUI 会错行）。
 */

interface TerminalPanelProps {
  /** 当前工作区根目录；未选择工作区时不允许开终端 */
  workspaceRoot: string | null;
}

export function TerminalPanel({ workspaceRoot }: TerminalPanelProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error' | 'exited'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  // ---- 订阅终端事件（挂载一次，避免重复订阅导致输出重复）----
  useEffect(() => {
    const unsubscribe = window.jujia.onTerminalStream((event) => {
      const term = termRef.current;
      if (!term) return;
      if (event.sessionId !== sessionRef.current) return;
      if (event.type === 'data') {
        term.write(event.chunk);
        return;
      }
      term.write(`\r\n\x1b[2m[进程已退出，退出码 ${event.exitCode}]\x1b[0m\r\n`);
      sessionRef.current = null;
      setStatus('exited');
    });
    return unsubscribe;
  }, []);

  // ---- 卸载时清理：销毁 xterm + 杀掉 PTY ----
  useEffect(() => {
    return () => {
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void window.jujia.terminalKill(id).catch(() => undefined);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (workspaceRoot === null) {
      setMessage('请先在工作区选择目录，再开终端（终端只能开在工作区内）');
      setStatus('error');
      return;
    }
    setStatus('starting');
    setMessage('等待审批…');

    const host = hostRef.current;
    if (!host) return;
    if (termRef.current === null) {
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
        if (id) void window.jujia.terminalInput(id, data).catch(() => undefined);
      });
      termRef.current = term;
      fitRef.current = fit;
    }

    const size = { cols: termRef.current.cols, rows: termRef.current.rows };
    const result = await window.jujia.terminalStart({
      workspaceRoot,
      cols: size.cols,
      rows: size.rows,
    });

    if (!result.ok) {
      // 如实展示被拒原因，不伪装成"已连接"
      setStatus('error');
      setMessage(result.error);
      return;
    }

    sessionRef.current = result.sessionId;
    setStatus('running');
    setMessage(null);
    termRef.current.focus();
  }, [workspaceRoot]);

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
          {status === 'exited' && '进程已退出'}
          {status === 'error' && '未启动'}
        </span>
        <button
          type="button"
          className="jj-btn jj-transition jj-pressable"
          onClick={() => void start()}
          disabled={status === 'starting' || status === 'running'}
        >
          {status === 'running' ? '已连接' : '启动终端（需审批）'}
        </button>
        <button
          type="button"
          className="jj-btn jj-transition"
          disabled={status !== 'running'}
          onClick={() => {
            const id = sessionRef.current;
            if (!id) return;
            void window.jujia.terminalKill(id).catch(() => undefined);
            sessionRef.current = null;
            setStatus('exited');
          }}
        >
          结束会话
        </button>
      </header>

      {message && <p className={status === 'error' ? 'p0-err' : 'p0-subtitle'}>{message}</p>}

      <p className="p0-subtitle">
        终端可执行任意命令，因此<strong>每次启动都要你确认</strong>
        （属高副作用能力）。会话在你离开此页时自动结束。
      </p>

      <div className="jj-terminal-host" ref={hostRef} />
    </section>
  );
}
