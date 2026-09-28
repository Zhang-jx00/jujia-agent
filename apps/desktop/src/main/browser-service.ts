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
  /**
   * 接下来那一下失败**是我们自己拦出来的**（拦导航 / 取消下载），不是网页坏了。
   *
   * 为什么要单独记：被我们 preventDefault 的导航，Electron 随后会抛一个 `ERR_FAILED (-2)`，
   * `did-fail-load` 和 `loadURL()` 的 catch 都看得见它 —— 不加这个标记，界面上真实的那句
   * "跳出用户打开的站点…已被拦下"会立刻被"加载失败 / 加载未完成"盖掉（e2e 实测就是这样红的）。
   * 一次性：谁消费谁清旗；成功落地或重新发起导航时也会清。
   */
  let blockedByUs = false;
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
    /**
     * 判档只留一个调用点（外部审查 T11）：`will-navigate` 与 `will-redirect` 两个钩子共用这一段。
     * `via` 只进日志、不进 `blocked.reason` —— 状态里那句理由必须保持单一来源，
     * 免得界面同时出现两种说法（e2e 的锚点就是策略原文）。
     */
    const guardPageNavigation = (
      event: { preventDefault: () => void },
      targetUrl: string,
      via: string,
    ): void => {
      const verdict = decideProgrammaticNavigation(userOrigin, targetUrl);
      if (verdict.allow) return;
      event.preventDefault();
      blocked = { url: targetUrl, reason: verdict.reason };
      blockedByUs = true;
      console.warn(`[browser] ${via}被拦：${targetUrl} —— ${verdict.reason}`);
      emit();
    };

    next.webContents.on('will-navigate', (event, targetUrl) => {
      guardPageNavigation(event, targetUrl, '页面跳转');
    });

    /**
     * **服务端重定向（302 / 301）不走 `will-navigate`**。这不是推测：Electron 44 实测
     * 一次跨站 302 的事件序列是 `did-start-navigation → will-redirect → did-redirect-navigation
     * → did-navigate`，`will-navigate` 一次都没响（见复核 038 的探针记录）。
     * 少挂这一条，"页面不许冒用用户点开的站点"这条底线在任何一个重定向面前整条失效 ——
     * 而重定向恰恰是**页面最能自己造**的那一跳（它连链接都不用点）。
     * 链式重定向每一跳各触发一次本事件，所以判定是逐跳的，不是只看第一跳。
     */
    next.webContents.on('will-redirect', (event, targetUrl) => {
      guardPageNavigation(event, targetUrl, '服务端重定向');
    });

    /**
     * ②' 下载（外部审查 T11）：**没有这一层时页面可以静默往本机写文件**。
     * 实测：不挂 `will-download` 时，第三方页面的附件下载不经任何询问就落进系统"下载"目录
     * （探针里两个 20 字节的 .tmp 就这么出现了，界面和状态一声不响）。
     * 本项目没有"下载管理"这套产品，所以一律拦下并把理由留在状态里 ——
     * 要真的下载，请用「用系统浏览器打开」在那一侧存。
     */
    const downloadGuard = (
      _event: Electron.Event,
      item: Electron.DownloadItem,
      sender: Electron.WebContents,
    ): void => {
      if (sender !== next.webContents) return; // 只管这张网页，别动应用自己的会话
      const name = item.getFilename();
      item.cancel();
      const downloadReason =
        `网页想保存文件「${name}」，已拦下：内置浏览器不替你往本机写东西。` +
        '需要下载的话，请用「用系统浏览器打开」在那个页面里存。';
      blocked = { url: item.getURL(), reason: downloadReason };
      blockedByUs = true;
      console.warn(`[browser] 已拦下网页发起的下载：${name}`);
      emit();
    };
    // 监听器挂在**共享的 default session** 上：视图销毁时必须摘掉，否则随每次开合累积
    const guestSession = next.webContents.session;
    guestSession.on('will-download', downloadGuard);

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
      blockedByUs = false;
      emit();
    });
    next.webContents.on('did-navigate-in-page', () => emit());
    next.webContents.on('page-title-updated', () => emit());
    next.webContents.on('did-fail-load', (_e, code, desc) => {
      if (code === -3 /* 主动中止 */) return;
      if (blockedByUs) {
        // 这一条失败就是刚拦下的那一跳的余波：界面上留着的必须是真实理由，不许写成"网页加载失败"
        blockedByUs = false;
        emit();
        return;
      }
      blocked = { url: '', reason: `加载失败（${String(code)} ${desc}）` };
      emit();
    });
    next.webContents.on('destroyed', () => {
      // 会话是共享的：监听器必须跟着这张网页一起走，不然开合十次就有十个 downloadGuard
      guestSession.off('will-download', downloadGuard);
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
    blockedByUs = false;
    view.setBounds(bounds);
    view.setVisible(true);
    try {
      await view.webContents.loadURL(decision.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (blockedByUs) {
        // 这一看就是"我们自己拦的"：Electron 抛的是 ERR_FAILED，但用户需要知道的是**为什么**被拦。
        // 把 loadURL 的报错当理由写进状态，等于把"这条底线起作用了"显示成"这个网页坏了"。
        blockedByUs = false;
        emit();
        // 走 state() 而不是直接读 `blocked`：拦下的那一刻理由是由事件回调写进去的，
        // 而 TS 的流程分析看不见跨 await 的闭包赋值（会把这里推断成 null / never）
        return { ok: false, reason: state().blocked?.reason ?? '导航已被拦下', state: state() };
      }
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
