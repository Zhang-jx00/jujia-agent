import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { BrowserExeState, BrowserOpenTarget, BrowserState } from '@jujia/shared-ipc';
import { IconRotateCw } from '../../ui/icons';

/**
 * 内置浏览器页签（M10 · 轨道扩容计划 1）。
 *
 * 为什么这里只有一个"占位 div"而没有真正的网页容器：
 * `WebContentsView` 是**浮在渲染层之上的原生视图**，CSS 管不到它。
 * 渲染层能做的是告诉主进程"我这块地方在哪、多大"，由主进程去摆它 —— 见 `reportBounds`。
 *
 * 三条刻意的取舍（不是漏做）：
 * 1. **离开页签就关闭视图**。视图浮在最上层，不收掉就会盖住别的页面；
 *    而且"看不见的网页还在后台跑"是最糟的状态。代价是切回来要重新打开 —— 已记入待办。
 * 2. **被拒绝的导航必须把理由显示出来**。"点了没反应"比"明确告诉你为什么不行"更让人怀疑自己。
 * 3. **"交给谁打开"是界面唯一的一个选择**。三档共用一条入口（`browserOpenWith`），
 *    授权强度由主进程判档：内置不问，外部两档每次硬 ask。
 *    这里刻意**不做任何"已经批过了"的缓存** —— 界面只负责问，不负责记。
 */

const TARGET_LABELS: ReadonlyArray<{ value: BrowserOpenTarget; label: string }> = [
  { value: 'internal', label: '内置视图（安全钩子全开）' },
  { value: 'system', label: '系统默认浏览器（每次确认）' },
  { value: 'custom', label: '自选本机程序（每次确认）' },
];

export function BrowserPanel(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState('');
  const [state, setState] = useState<BrowserState | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<BrowserOpenTarget>('internal');
  const [exe, setExe] = useState<BrowserExeState | null>(null);

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
    // 默认档读配置（主进程在"真的打开成功"之后才会写它），自选程序状态每次现读
    void window.jujia
      .configGet()
      .then((snapshot) => setTarget(snapshot.config.browserOpenWith))
      .catch(() => undefined);
    void window.jujia
      .browserExeGet()
      .then(setExe)
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
    async (raw: string): Promise<void> => {
      const url = raw.trim();
      if (url === '') {
        setMessage({ kind: 'error', text: '请先输入网址' });
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        // 三档共用这一条入口；**授权发生在主进程**，这里只如实转达结果
        const result = await window.jujia.browserOpenWith(url, target);
        if (result.state !== null) setState(result.state);
        if (!result.ok) {
          // 拒绝必须可见：把主进程给的理由原样显示，不润色成"打开失败"
          setMessage({ kind: 'error', text: `未打开：${result.error ?? '未知原因'}` });
          return;
        }
        if (result.target === 'internal') {
          setMessage({ kind: 'ok', text: `已打开 ${result.state?.url ?? url}` });
          void reportBounds();
          return;
        }
        // 外部两档把"是否过了人手"说出来：用户点过确认与"策略直接放行"是两件不同的事，
        // 混成一句"已打开"就会让人以为问都没问
        setMessage({
          kind: 'ok',
          text:
            (result.asked ? '你确认后，地址已交给' : '按当前权限策略，地址已交给') +
            (result.target === 'custom' ? '自选程序' : '系统默认浏览器'),
        });
      } catch (err) {
        setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [target, reportBounds],
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

  /**
   * 选定 / 清除自选程序。
   *
   * 注意这里**没有输入框**：路径只能由主进程弹出的原生文件对话框产生（`browserExePick`），
   * 界面能做的只有"发起选择"和"清空"。少开一个口子，就少一处"渲染层说了算"。
   */
  const refreshExe = useCallback(async (): Promise<void> => {
    setExe(await window.jujia.browserExeGet());
  }, []);

  const pickExe = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.jujia.browserExePick();
      setMessage({
        kind: result.ok ? 'ok' : 'error',
        text: result.ok ? result.message : result.error,
      });
      await refreshExe();
    } finally {
      setBusy(false);
    }
  }, [refreshExe]);

  const clearExe = useCallback(async (): Promise<void> => {
    const result = await window.jujia.browserExeClear();
    setMessage({ kind: result.ok ? 'ok' : 'error', text: result.ok ? result.message : result.error });
    await refreshExe();
  }, [refreshExe]);

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
        <select
          className="jj-field"
          value={target}
          aria-label="打开方式"
          onChange={(e) => setTarget(e.target.value as BrowserOpenTarget)}
        >
          {TARGET_LABELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
          <IconRotateCw size={14} />
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

      {/* 外部两档把"为什么要问我一次"说在前面，而不是等弹窗出现时才让人猜 */}
      {target !== 'internal' && (
        <p className="jj-muted">
          这一档会把地址交给应用之外的程序，每次打开都先问你一次 ——
          记住的只是"默认停在哪一档"，不是授权。
        </p>
      )}

      {target === 'custom' && (
        <p className="jj-note-warn">
          {`自选程序：${exe?.path ?? '还没选（选一次就记住路径，但每次打开仍要确认）'}`}
          {exe !== null && exe.path !== null && !exe.usable ? ' —— 这个文件现在找不到了，请重新选' : ''}
          {' '}
          <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => void pickExe()} disabled={busy}>
            选择程序
          </button>
          {exe?.path != null && (
            <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => void clearExe()} disabled={busy}>
              清除
            </button>
          )}
        </p>
      )}

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
