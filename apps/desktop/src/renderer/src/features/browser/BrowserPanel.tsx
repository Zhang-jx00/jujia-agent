import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { BrowserState } from '@jujia/shared-ipc';

/**
 * 内置浏览器页签（M10 · 轨道扩容计划 1 第 2 步）。
 *
 * 为什么这里只有一个"占位 div"而没有真正的网页容器：
 * `WebContentsView` 是**浮在渲染层之上的原生视图**，CSS 管不到它。
 * 渲染层能做的是告诉主进程"我这块地方在哪、多大"，由主进程去摆它 —— 见 `reportBounds`。
 *
 * 两条刻意的取舍（不是漏做）：
 * 1. **离开页签就关闭视图**。视图浮在最上层，不收掉就会盖住别的页面；
 *    而且"看不见的网页还在后台跑"是最糟的状态。代价是切回来要重新打开 —— 已记入待办。
 * 2. **被拒绝的导航必须把理由显示出来**。"点了没反应"比"明确告诉你为什么不行"更让人怀疑自己。
 */
export function BrowserPanel(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState('');
  const [state, setState] = useState<BrowserState | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** 把占位区的位置与尺寸报给主进程（视图据此摆放） */
  const reportBounds = useCallback(async (): Promise<void> => {
    const host = hostRef.current;
    if (host === null) return;
    const rect = host.getBoundingClientRect();
    try {
      await window.jujia.browserSetBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    } catch {
      // 尺寸上报失败不影响功能：视图停在最后一次成功的位置，用户重开即可
    }
  }, []);

  // 订阅状态变化 + 跟随布局（窗口缩放、面板尺寸变化都会改变占位区，视图必须跟上）
  useEffect(() => {
    const unsubscribe = window.jujia.onBrowserState(setState);
    void window.jujia
      .browserState()
      .then(setState)
      .catch(() => undefined);

    const host = hostRef.current;
    let observer: ResizeObserver | null = null;
    if (host !== null && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => void reportBounds());
      observer.observe(host);
    }
    const onWindowResize = (): void => void reportBounds();
    window.addEventListener('resize', onWindowResize);

    return () => {
      unsubscribe();
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [reportBounds]);

  // 打开之后（以及每次 open 状态翻转）重报一次尺寸，否则新出现的视图会停在 0×0
  useEffect(() => {
    if (state?.open === true) void reportBounds();
  }, [state?.open, reportBounds]);

  const go = useCallback(
    async (url: string): Promise<void> => {
      const target = url.trim();
      if (target === '') {
        setMessage({ kind: 'error', text: '请先输入网址' });
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        const result = state?.open === true
          ? await window.jujia.browserNavigate(target)
          : await window.jujia.browserOpen(target);
        setState(result.state);
        if (!result.ok) {
          // 拒绝必须可见：把主进程给的理由原样显示，不润色成"打开失败"
          setMessage({ kind: 'error', text: `已拒绝：${result.reason}` });
          void reportBounds();
        } else {
          setMessage({ kind: 'ok', text: `已打开 ${result.state.url}` });
          void reportBounds();
        }
      } catch (err) {
        setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [state?.open, reportBounds],
  );

  const act = useCallback(
    async (fn: () => Promise<BrowserState>): Promise<void> => {
      setBusy(true);
      try {
        setState(await fn());
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const readText = useCallback(async (): Promise<void> => {
    const result = await window.jujia.browserGetText();
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    setMessage({
      kind: 'info',
      text:
        `已读取 ${result.origin} 的正文：${String(result.text.length)} 字` +
        // 截断必须说出来 —— 悄悄截了，模型就会以为自己看到了整页
        (result.truncated ? '（已截断到上限，非全文）' : '（全文）'),
    });
  }, []);

  // 离开页签：收掉浮在上层的视图
  useEffect(() => {
    return () => {
      void window.jujia.browserClose().catch(() => undefined);
    };
  }, []);

  const opened = state?.open === true;

  return (
    <section className="jj-browser">
      <header className="jj-browser-head">
        <input
          className="jj-field"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go(address);
          }}
          placeholder="输入网址，回车打开（只支持 http/https）"
          spellCheck={false}
          aria-label="地址栏"
        />
        <button
          type="button"
          className="jj-btn jj-transition"
          onClick={() => void go(address)}
          disabled={busy}
        >
          打开
        </button>
        <button
          type="button"
          className="jj-btn jj-btn-quiet jj-transition jj-pressable"
          onClick={() => void act(window.jujia.browserBack)}
          disabled={!opened || state?.canGoBack !== true || busy}
          title="后退"
        >
          ←
        </button>
        <button
          type="button"
          className="jj-btn jj-btn-quiet jj-transition jj-pressable"
          onClick={() => void act(window.jujia.browserForward)}
          disabled={!opened || state?.canGoForward !== true || busy}
          title="前进"
        >
          →
        </button>
        <button
          type="button"
          className="jj-btn jj-btn-quiet jj-transition jj-pressable"
          onClick={() => void act(window.jujia.browserReload)}
          disabled={!opened || busy}
          title="重新加载"
        >
          ⟳
        </button>
        <button
          type="button"
          className="jj-btn jj-btn-quiet jj-transition"
          onClick={() => void act(window.jujia.browserClose)}
          disabled={!opened}
        >
          关闭
        </button>
        <button
          type="button"
          className="jj-btn jj-transition"
          onClick={() => void readText()}
          disabled={!opened || busy}
          title="读取本页可见文本（交给模型作为上下文）"
        >
          读正文
        </button>
      </header>

      <p className="p0-subtitle">
        {opened
          ? `当前：${String(state?.url)}${state?.loopback === true ? '（本机地址）' : ''}`
          : '尚未打开。只会加载 http/https；file、javascript、data 等协议一律拒绝并说明原因。'}
      </p>

      {message !== null && (
        <p
          className={
            message.kind === 'error' ? 'p0-err' : message.kind === 'ok' ? 'jj-ok' : 'jj-muted'
          }
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      {/* 策略拒绝过什么，明确列出来：这是"为什么没跳过去"的答案所在 */}
      {state?.blocked !== null && state?.blocked !== undefined && (
        <p className="jj-note-warn" role="status">
          被拦下的导航：<code>{state.blocked.url}</code> —— {state.blocked.reason}
        </p>
      )}

      <div className="jj-browser-host" ref={hostRef} aria-label="网页显示区" />
    </section>
  );
}
