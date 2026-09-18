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

/** 允许导航的源：仅应用自身；开发模式额外放行 vite dev server。 */
export function isAllowedNavigation(targetUrl: string, devServerUrl?: string): boolean {
  try {
    const target = new URL(targetUrl);
    if (target.protocol === 'file:') return true;
    if (devServerUrl && target.origin === new URL(devServerUrl).origin) return true;
    return false;
  } catch {
    return false;
  }
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
  opts: { devServerUrl?: string | undefined } = {},
): void {
  const { webContents } = win;

  // 新窗口请求一律拒绝，安全 URL 转交系统浏览器
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });

  // 禁止渲染层导航离开应用自身
  webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, opts.devServerUrl)) {
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
