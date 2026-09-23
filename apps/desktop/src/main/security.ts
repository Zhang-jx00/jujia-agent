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
export function secureWebPreferences(preload: string): WebPreferences {
  return {
    contextIsolation: SECURITY_BASELINE.contextIsolation,
    sandbox: SECURITY_BASELINE.sandbox,
    nodeIntegration: SECURITY_BASELINE.nodeIntegration,
    webSecurity: SECURITY_BASELINE.webSecurity,
    webviewTag: SECURITY_BASELINE.webviewTag,
    preload,
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
 * 为什么需要：33 个 `ipcMain.handle` 此前都无条件接受任何发送方。
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
  void shell.openExternal(url);
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
