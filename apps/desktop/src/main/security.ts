import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow, WebPreferences } from 'electron';
import { shell } from 'electron';
import { SECURITY_BASELINE } from '@jujia/shared-ipc';

/**
 * 安全基线的**字面量真值**——断言唯一依据，刻意不复用 SECURITY_BASELINE。
 *
 * 复核发现（2026-09-18 第二遍）：初版 `assertSecureWebPreferences` 既用 SECURITY_BASELINE
 * 生成配置、又用同一个常量做断言，属**自引用校验**：一旦常量被误改为不安全值，
 * 两层会同时失效而不报错。此处改为独立字面量，并对常量本身做一致性断言。
 */
const REQUIRED_SECURE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
} as const;

/** 常量必须与字面量真值一致；否则说明基线被改坏，直接拒绝启动 */
export function assertBaselineConstantIntact(): void {
  for (const [key, expected] of Object.entries(REQUIRED_SECURE)) {
    const actual = (SECURITY_BASELINE as Record<string, unknown>)[key];
    if (actual !== expected) {
      throw new Error(
        `[security] SECURITY_BASELINE.${key} 被改为 ${String(actual)}，应为 ${String(expected)}`,
      );
    }
  }
}

/**
 * 唯一的安全 webPreferences 模板。
 * 所有 BrowserWindow / WebContentsView 必须使用它，禁止各自手写。
 *
 * 说明：Electron 44 已移除 `webContents.getLastWebPreferences()`，
 * 因此改为「传参前断言配置对象」的方式自检——纯函数、可单测、不依赖已废弃 API。
 */
export function secureWebPreferences(
  preload: string,
  /**
   * 唯一的可选位（R32 展示页截图）：`offscreen` 让窗口**不进屏幕也照常画**。
   *
   * 为什么留这一个口子而不是让调用方自己拼 `webPreferences`：这个函数是**安全基线的出口**，
   * 拼一份出来的那份绕过 `assertSecureWebPreferences`。所以扩展只走"加一个具名选项"这条路，
   * 而且**只给 true 或不给这个键** —— `offscreen: options.offscreen` 那种写法会把 `undefined`
   * 塞进对象（`exactOptionalPropertyTypes` 下编译不过，但先拦住写法比等编译报错更早）。
   */
  options: { offscreen?: boolean } = {},
): WebPreferences {
  return {
    contextIsolation: SECURITY_BASELINE.contextIsolation,
    sandbox: SECURITY_BASELINE.sandbox,
    nodeIntegration: SECURITY_BASELINE.nodeIntegration,
    webSecurity: SECURITY_BASELINE.webSecurity,
    webviewTag: SECURITY_BASELINE.webviewTag,
    preload,
    ...(options.offscreen ? { offscreen: true } : {}),
  };
}

/** 安全基线自检：任一不符直接抛错，拒绝启动（fail closed）。断言依据为字面量真值。 */
export function assertSecureWebPreferences(prefs: WebPreferences): void {
  assertBaselineConstantIntact();

  if (prefs.contextIsolation !== REQUIRED_SECURE.contextIsolation) {
    throw new Error('[security] contextIsolation 必须为 true');
  }
  if (prefs.sandbox !== REQUIRED_SECURE.sandbox) {
    throw new Error('[security] sandbox 必须为 true');
  }
  if (prefs.nodeIntegration === true) {
    throw new Error('[security] nodeIntegration 必须为 false');
  }
  if (prefs.webSecurity === false) {
    throw new Error('[security] webSecurity 不得关闭');
  }
  if (prefs.webviewTag === true) {
    throw new Error('[security] webviewTag 必须关闭（内置浏览器用 WebContentsView）');
  }
  if (!prefs.preload) {
    throw new Error('[security] 必须指定 preload 桥');
  }
}

/**
 * 内置浏览器（`WebContentsView`）的 webPreferences —— **刻意不复用 `secureWebPreferences`**。
 *
 * 为什么必须另开一份：`secureWebPreferences(preload)` 要求传 preload 桥，
 * 而 preload 桥 = `window.jujia` = 整套 IPC 能力。**把 preload 给第三方网页，
 * 等于把网页变成一个能调所有通道的调用方** —— 那正是这个项目最不想要的一次授权。
 * 所以浏览器视图的底线是：**安全开关同样全开，但没有 preload**。
 *
 * 第二道防线在 `ipc.ts` 的统一入口：`isTrustedSenderUrl` 只认"渲染层目录之内的 file: 或 dev server 源"，
 * 第三方网页两者都不是，即使它拿到某个桥也调不动 IPC。但**我们仍然不给桥**（纵深防御，不依赖单点）。
 */
export function browserViewPreferences(): WebPreferences {
  return {
    contextIsolation: SECURITY_BASELINE.contextIsolation,
    sandbox: SECURITY_BASELINE.sandbox,
    nodeIntegration: SECURITY_BASELINE.nodeIntegration,
    webSecurity: SECURITY_BASELINE.webSecurity,
    webviewTag: SECURITY_BASELINE.webviewTag,
    // **不设 preload**：第三方网页拿不到应用的能力桥
  };
}

/**
 * 浏览器视图的配置自检：安全开关全开，**且必须没有 preload**。
 *
 * 为什么单独写一条断言而不是复用 `assertSecureWebPreferences`：后者要求"必须有 preload"，
 * 复用它等于强迫我给网页配桥（或者把它改松 —— 那更糟，主窗口的自检就废了）。
 * 这条与那条各自严格，改任何一边都不会让另一边悄悄松掉。
 */
export function assertBrowserViewPreferences(prefs: WebPreferences): void {
  assertBaselineConstantIntact();
  if (prefs.contextIsolation !== true) throw new Error('[browser] contextIsolation 必须为 true');
  if (prefs.sandbox !== true) throw new Error('[browser] sandbox 必须为 true');
  if (prefs.nodeIntegration === true) throw new Error('[browser] nodeIntegration 必须为 false');
  if (prefs.webSecurity === false) throw new Error('[browser] webSecurity 不得关闭');
  if (prefs.webviewTag === true) throw new Error('[browser] webviewTag 必须关闭');
  if (prefs.preload !== undefined) throw new Error('[browser] 第三方网页绝不能拿到 preload 能力桥');
}

/**
 * 允许导航的源：仅应用自身；开发模式额外放行 vite dev server。
 *
 * **`file:` 不再无条件放行**（2026-09-23 修）：
 * 此前任何 `file:` URL 都被视为"应用自身"，于是 `file:///C:/任意本地.html`
 * 也能把主窗口导航过去 —— 那等于把渲染层换成一页本地文件，
 * 而渲染层手里有 preload 桥（能调所有 IPC）。现在只允许**渲染层目录之内**的 file:；
 * 没给定基线目录时**一律不放行**（fail closed）。
 */
export function isAllowedNavigation(
  targetUrl: string,
  devServerUrl?: string,
  rendererDir?: string,
): boolean {
  try {
    const target = new URL(targetUrl);
    if (target.protocol === 'file:') {
      if (rendererDir === undefined) return false;
      const base = resolve(rendererDir);
      const rel = relative(base, resolve(fileURLToPath(target)));
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    }
    if (devServerUrl && target.origin === new URL(devServerUrl).origin) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 校验 IPC 调用来自**我们自己的渲染层**（2026-09-23 补）。
 *
 * 为什么需要：全部 `ipcMain.handle`（通道清单以 `@jujia/shared-ipc` 的 `channels.ts` 为准）
 * 此前都无条件接受任何发送方。
 * 渲染层的导航与新窗口已被基线挡住，所以这不是"已经能被利用"，
 * 而是**纵深防御**：将来一旦引入 WebContentsView（内置浏览器）、扩展页面或任何
 * 第二个 webContents，没有这道校验就等于给它开了全套 IPC。
 *
 * 判定依据是发送方 frame 的 URL：必须是应用自身（file: 且落在渲染层目录内），
 * 或开发模式下的 dev server 源。拿不到 URL 时**拒绝**（fail closed）。
 */
export function isTrustedSenderUrl(senderUrl: string, devServerUrl?: string, rendererDir?: string): boolean {
  if (senderUrl === '') return false;
  if (senderUrl.startsWith('devtools://')) return true; // 开发者工具自身的调用
  return isAllowedNavigation(senderUrl, devServerUrl, rendererDir);
}

export function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

/** 仅对 http/https 调用系统浏览器打开，其余 scheme 一律拒绝。 */
export function openExternalIfSafe(url: string): boolean {
  if (!/^https?:$/.test(safeProtocol(url))) {
    console.warn('[security] 已拒绝外部打开（非 http/https）:', url);
    return false;
  }
  // 失败不许吞（T40，2026-10-14 修）：与 open-with-launch.ts 同一口径 ——
  // `void` 掉等于"点了没反应"且无记录；这里至少留下可查的痕。
  void shell.openExternal(url).catch((err: unknown) => {
    console.error('[security] 系统浏览器打开失败：', err);
  });
  return true;
}

export function applySecurityBaseline(
  win: BrowserWindow,
  opts: { devServerUrl?: string | undefined; rendererDir?: string | undefined } = {},
): void {
  const { webContents } = win;

  // 新窗口请求一律拒绝，安全 URL 转交系统浏览器
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });

  // 禁止渲染层导航离开应用自身
  webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, opts.devServerUrl, opts.rendererDir)) {
      event.preventDefault();
      console.warn('[security] 已拦截导航:', url);
    }
  });

  // 禁止挂载 <webview>（内置浏览器将使用 WebContentsView）
  webContents.on('will-attach-webview', (event, webPreferences) => {
    event.preventDefault();
    delete webPreferences.preload;
  });

  // 权限请求默认全部拒绝（后续按需逐项申请）
  webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    console.warn('[security] 已拒绝权限请求:', permission);
    callback(false);
  });
}
