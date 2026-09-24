import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IPC } from '@jujia/shared-ipc';
import {
  assertBrowserViewPreferences,
  assertSecureWebPreferences,
  browserViewPreferences,
  secureWebPreferences,
} from './security';

/**
 * 内置浏览器（M10）的接线与安全底线。
 *
 * 两条纪律在此落实（都来自复核台账踩过的坑）：
 * - **抽出纯函数后必须锁"真的在用它"**：否则单测测的是死代码，运行路径照旧绕过策略；
 * - **源码扫描类断言先剥注释**，且断言字符串要含足以区分"赋值 / 比较 / 注释"的上下文
 *   （复核 009 栽在没剥注释，复核 017 栽在 `X =` 被紧邻的 `X === undefined` 满足）。
 */

const here = dirname(fileURLToPath(import.meta.url));

/** 剥掉块注释与行注释，只留可执行代码 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const browserSource = stripComments(readFileSync(join(here, 'browser-service.ts'), 'utf8'));
const ipcSource = stripComments(readFileSync(join(here, 'ipc.ts'), 'utf8'));

describe('浏览器视图的安全底线（视图配置 ≠ 主窗口配置）', () => {
  it('视图配置拿不到 preload 桥：第三方网页绝不能有应用的能力', () => {
    const prefs = browserViewPreferences();
    // 写死字面量真值来断言，不复用 browserViewPreferences 的返回值自己证自己
    expect(prefs.preload).toBeUndefined();
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.webviewTag).toBe(false);
    expect(() => assertBrowserViewPreferences(prefs)).not.toThrow();
  });

  it('给视图配上 preload 时自检必须抛（这条是特性，不是笔误）', () => {
    const bad = { ...browserViewPreferences(), preload: join(here, 'preload', 'index.js') };
    expect(() => assertBrowserViewPreferences(bad)).toThrow(/preload/);
  });

  it('主窗口那条自检没被放宽：它仍然要求必须有 preload', () => {
    // 加浏览器视图时最容易发生的事故是"为了共用而把 assertSecureWebPreferences 的 preload 检查删掉"
    const preloadPath = join(here, 'preload', 'index.js');
    expect(() => assertSecureWebPreferences(secureWebPreferences(preloadPath))).not.toThrow();
    const noPreload = { ...secureWebPreferences(preloadPath) };
    delete noPreload.preload;
    expect(() => assertSecureWebPreferences(noPreload)).toThrow(/preload/);
  });
});

describe('接线锁：策略确实在运行路径上（不是只活在单测里的死代码）', () => {
  it('页面发起的导航过 decideProgrammaticNavigation，被拒时 preventDefault', () => {
    expect(browserSource).toContain("on('will-navigate'");
    expect(browserSource).toContain('decideProgrammaticNavigation(userOrigin, targetUrl)');
    expect(browserSource).toContain('event.preventDefault()');
  });

  it('用户主动导航走 decideUserNavigation（与页面导航是两条路径）', () => {
    expect(browserSource).toContain('decideUserNavigation(rawUrl)');
  });

  it('新窗口一律 deny，且同样经 decideNavigation 判定', () => {
    expect(browserSource).toContain('setWindowOpenHandler');
    expect(browserSource).toContain('decideNavigation(url)');
    expect(browserSource).toContain("action: 'deny'");
  });

  it('视图创建前自检，且用的是视图专用断言（不是主窗口那个）', () => {
    expect(browserSource).toContain('assertBrowserViewPreferences(prefs)');
    expect(browserSource).not.toContain('assertSecureWebPreferences');
  });

  it('被拒的导航把理由留在状态里（拒绝必须可见，不是静默失败）', () => {
    expect(browserSource).toContain('blocked = { url: targetUrl, reason: verdict.reason }');
  });

  it('退出时销毁浏览器视图（不留孤儿 webContents）', () => {
    expect(ipcSource).toContain('browser.dispose()');
  });

  it('每条浏览器通道都在统一入口后面注册（新通道默认受发送方校验保护）', () => {
    const channels = [
      'BROWSER_OPEN',
      'BROWSER_NAVIGATE',
      'BROWSER_BACK',
      'BROWSER_FORWARD',
      'BROWSER_RELOAD',
      'BROWSER_CLOSE',
      'BROWSER_SET_BOUNDS',
      'BROWSER_GET_TEXT',
      'BROWSER_STATE',
    ];
    for (const name of channels) {
      // 必须是 `handle(IPC.X` 开头 —— 直接写 ipcMain.handle 会绕开发送方校验
      expect(ipcSource).toContain(`handle(IPC.${name},`);
    }
    // 反向锁：浏览器通道绝不能出现裸 ipcMain.handle（绕过统一入口 = 绕过安全默认值）
    const bare = ipcSource.match(/ipcMain\.handle\(/g) ?? [];
    expect(bare.length).toBe(1); // 只允许统一入口里那一次
  });
});

describe('契约边界：渲染层拿不到越权能力', () => {
  it('读正文的表达式写死在字符串里（不提供"执行任意 JS"的通道）', () => {
    // 若哪天变成 executeJavaScript(payload.code) 这种形状，这条会红 —— 那正是必须拦住的改动
    expect(browserSource).toContain("executeJavaScript('document.body ? document.body.innerText : \"\"')");
    // 契约层同样不得开出"让网页求值"的通道。用 IPC 对象断言，而不是去数文件里的字符串
    const names = Object.keys(IPC).join(' ');
    const values = Object.values(IPC).join(' ');
    expect(names).not.toMatch(/EVALUATE|EXEC|INJECT/i);
    expect(values).not.toMatch(/evaluate|execute|inject/);
  });
});
