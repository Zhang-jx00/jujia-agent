import { WebContentsView } from 'electron';
import {
  decideNavigation,
  decideProgrammaticNavigation,
  decideUserNavigation,
  isLoopbackHost,
} from '@jujia/agent-core';
import type { BrowserState } from '@jujia/shared-ipc';
import { assertBrowserViewPreferences, browserViewPreferences } from './security';

/**
 * 内置浏览器（M10 · 轨道扩容计划 1 第 2 步）。
 *
 * 为什么用 `WebContentsView` 而不是 `<webview>`：官方已把 webview 归为"不推荐的旧路径"，
 * 而 `<webview>` 需要 `webviewTag: true` —— 那等于给渲染层开一个能加载任意内容的逃逸口，
 * 与本项目的安全基线（`webviewTag: false`）直接冲突。
 *
 * 三条底线（每条都有对应的测试）：
 * 1. **不给网页 preload 桥**：网页拿不到 `window.jujia`，也就拿不到任何 IPC 能力；
 * 2. **所有导航都过 `decideNavigation`**，包括程序化的（`location.href=`、meta refresh、重定向）——
 *    写在 `will-navigate` 上而不是只写在"用户点打开"那条路径上，正因为要拦的不是用户；
 * 3. **页面不许自己跳出用户选定的站点**：见 `decideProgrammaticNavigation`。
 */

/** 读正文的默认上限；超限截断并如实标注，绝不静默 */
const DEFAULT_MAX_TEXT_CHARS = 20_000;

/**
 * 策略判定**不在本文件里**：全部走 `@jujia/agent-core` 的 `browser/policy.ts`
 * （纯函数、已有测试钉着、可做变异）。本文件只负责 Electron 的接线与生命周期 ——
 * 这样"什么能开"这套规则不依赖 Electron 也能被测，改胶水不会悄悄改掉规则。
 */

export interface BrowserServiceDeps {
  /** 取当前主窗口；窗口没了就不动视图 */
  getWindow: () => Electron.BrowserWindow | undefined;
  /** 状态变化回调（由 ipc.ts 接到 BROWSER_STATE_CHANGED 推给渲染层） */
  onChanged?: ((state: BrowserState) => void) | undefined;
  /** 读正文上限（测试注入小值用） */
  maxTextChars?: number | undefined;
}

export interface BrowserService {
  open: (rawUrl: string) => Promise<{ ok: boolean; reason?: string; state: BrowserState }>;
  navigate: (rawUrl: string) => Promise<{ ok: boolean; reason?: string; state: BrowserState }>;
  back: () => BrowserState;
  forward: () => BrowserState;
  reload: () => BrowserState;
  close: () => void;
  setBounds: (b: { x: number; y: number; width: number; height: number }) => void;
  getText: () => Promise<{ ok: true; origin: string; text: string; truncated: boolean } | { ok: false; error: string }>;
  state: () => BrowserState;
  /** 应用退出时销毁，不留孤儿 webContents */
  dispose: () => void;
}

export function createBrowserService(deps: BrowserServiceDeps): BrowserService {
  const maxChars = deps.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  let view: WebContentsView | null = null;
  /** 用户**主动**打开的那个 origin；页面自己跳出不去它 */
  let userOrigin: string | null = null;
  let blocked: { url: string; reason: string } | null = null;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };

  const alive = (v: WebContentsView | null): v is WebContentsView =>
    v !== null && !v.webContents.isDestroyed();

  /** 网址解析不了就当不是本机 —— 这个标记只用于界面提示，不参与任何放行判定 */
  const readLoopback = (url: string): boolean => {
    try {
      return isLoopbackHost(new URL(url).hostname);
    } catch {
      return false;
    }
  };

  const state = (): BrowserState => {
    if (!alive(view)) {
      return {
        open: false,
        url: '',
        title: '',
        canGoBack: false,
        canGoForward: false,
        loopback: false,
        blocked,
      };
    }
    const wc = view.webContents;
    const url = wc.getURL();
    return {
      open: true,
      url,
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      loopback: readLoopback(url),
      blocked,
    };
  };

  const emit = (): void => {
    deps.onChanged?.(state());
  };

  /** 挂到窗口上并绑定全部安全钩子。返回 false = 没有可用窗口 */
  const attach = (): boolean => {
    const win = deps.getWindow();
    if (win === undefined || win.isDestroyed()) return false;

    const prefs = browserViewPreferences();
    // 配置自检：不安全就**直接抛**（fail closed），而不是带着不安全的视图继续跑
    assertBrowserViewPreferences(prefs);

    const next = new WebContentsView({ webPreferences: prefs });
    view = next;

    // ① 页面发起的导航：协议策略 + 不许跳出用户所选站点
    next.webContents.on('will-navigate', (event, targetUrl) => {
      const verdict = decideProgrammaticNavigation(userOrigin, targetUrl);
      if (!verdict.allow) {
        event.preventDefault();
        blocked = { url: targetUrl, reason: verdict.reason };
        console.warn(`[browser] ${verdict.reason}`);
        emit();
      }
    });

    // ② 新窗口请求：一律不开。合法的才允许"交给系统浏览器"（由用户决定，不是我们决定）
    next.webContents.setWindowOpenHandler(({ url }) => {
      const decision = decideNavigation(url);
      blocked = {
        url,
        reason: decision.allow
          ? '这里不开新窗口（保持只有一个受控视图）；需要的话请用「用系统浏览器打开」'
          : `连外部打开都不做：${decision.reason}`,
      };
      console.warn(`[browser] 已拒绝新窗口：${url}`);
      emit();
      return { action: 'deny' };
    });

    // ③ 权限请求默认拒绝：网页要地理定位/通知/剪贴板，一律不给（和主窗口的基线一致）
    next.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      console.warn(`[browser] 已拒绝网页的权限请求: ${permission}`);
      callback(false);
    });

    next.webContents.on('did-navigate', () => {
      // 成功落地的导航清掉旧的拒绝提示（拒绝提示只在**当下**有意义）
      blocked = null;
      emit();
    });
    next.webContents.on('did-navigate-in-page', () => emit());
    next.webContents.on('page-title-updated', () => emit());
    next.webContents.on('did-fail-load', (_e, code, desc) => {
      if (code !== -3 /* 主动中止 */) blocked = { url: '', reason: `加载失败（${String(code)} ${desc}）` };
      emit();
    });
    next.webContents.on('destroyed', () => {
      if (view === next) {
        view = null;
        userOrigin = null;
      }
    });

    const winView = win.contentView;
    winView.addChildView(next);
    next.setBounds(bounds);
    return true;
  };

  const detach = (): void => {
    if (!alive(view)) {
      view = null;
      userOrigin = null;
      return;
    }
    const doomed = view;
    view = null;
    userOrigin = null;
    const win = deps.getWindow();
    if (win !== undefined && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(doomed);
      } catch {
        // 视图可能已被 Electron 自行摘除；摘不掉也继续往下销毁
      }
    }
    if (!doomed.webContents.isDestroyed()) doomed.webContents.close();
  };

  const goTo = async (
    rawUrl: string,
  ): Promise<{ ok: boolean; reason?: string; state: BrowserState }> => {
    const decision = decideUserNavigation(rawUrl);
    if (!decision.allow) {
      blocked = { url: rawUrl, reason: decision.reason };
      console.warn(`[browser] 已拒绝导航：${decision.reason}`);
      return { ok: false, reason: decision.reason, state: state() };
    }

    if (view === null) {
      if (!attach()) {
        return { ok: false, reason: '没有可用的主窗口，无法打开浏览器', state: state() };
      }
    }
    if (!alive(view)) return { ok: false, reason: '浏览器视图未能创建', state: state() };

    // **先记用户本意的 origin，再加载** —— 否则首个页面里的同步跳转会被自己拦掉
    try {
      userOrigin = new URL(decision.url).origin;
    } catch {
      userOrigin = null;
    }
    blocked = null;
    view.setBounds(bounds);
    view.setVisible(true);
    try {
      await view.webContents.loadURL(decision.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 加载被中止/失败不算越界：把理由回给用户，视图保留（可继续输入别的地址）
      blocked = { url: decision.url, reason: `加载未完成：${message}` };
      emit();
      return { ok: false, reason: message, state: state() };
    }
    emit();
    return { ok: true, state: state() };
  };

  return {
    open: (rawUrl) => goTo(rawUrl),
    navigate: async (rawUrl) => {
      if (!alive(view)) return goTo(rawUrl); // 没开过就按"打开"处理
      return goTo(rawUrl);
    },
    back() {
      if (alive(view) && view.webContents.canGoBack()) view.webContents.goBack();
      emit();
      return state();
    },
    forward() {
      if (alive(view) && view.webContents.canGoForward()) view.webContents.goForward();
      emit();
      return state();
    },
    reload() {
      if (alive(view)) view.webContents.reload();
      emit();
      return state();
    },
    close() {
      detach();
      emit();
    },
    setBounds(b) {
      bounds = b;
      if (alive(view)) view.setBounds(b);
    },
    async getText() {
      if (!alive(view)) return { ok: false, error: '浏览器尚未打开' };
      const wc = view.webContents;
      const url = wc.getURL();
      if (url === '') return { ok: false, error: '页面还没加载完成，没有正文可读' };
      // 只读：取可见文本。不给 evaluate 任意代码的口子 —— 表达式写死在这里
      let raw: string;
      try {
        const got = (await wc.executeJavaScript('document.body ? document.body.innerText : ""')) as unknown;
        raw = typeof got === 'string' ? got : '';
      } catch (err) {
        return { ok: false, error: `读取正文失败：${err instanceof Error ? err.message : String(err)}` };
      }
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        origin = url;
      }
      const truncated = raw.length > maxChars;
      return { ok: true, origin, text: truncated ? raw.slice(0, maxChars) : raw, truncated };
    },
    state,
    dispose() {
      detach();
    },
  };
}
