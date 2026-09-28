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
// R-12 拆分后：浏览器通道的注册在 ipc/browser.ts；跨文件的「全仓只有一处裸入口」由 ipc-wiring.test.ts 统一锁
const ipcSource = stripComments(readFileSync(join(here, 'ipc', 'browser.ts'), 'utf8'));

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

  /**
   * 外部审查 T11 · 服务端重定向。
   *
   * 为什么单独锁一条：`will-navigate` 只管"用户或页面主动发起"的那一跳，**服务端 302/301 换页不走它**
   * （Electron 44 实测，见复核 038：302 只触发 `did-start-navigation` → `will-redirect` →
   * `did-redirect-navigation` → `did-navigate`，`will-navigate` 一次都没响）。
   * 只挂 `will-navigate` 的旧接线，等于"用户点开的站点不被页面冒用"这条底线在重定向面前整条失效。
   */
  it('服务端重定向也过同一条 origin 锁（302/301 不许绕过）', () => {
    expect(browserSource).toContain("on('will-redirect'");
    expect(browserSource).toContain("guardPageNavigation(event, targetUrl, '服务端重定向')");
  });

  it('origin 判定只有一处：两个钩子共用同一个判档点（不许长出第二份真相）', () => {
    const hits = browserSource.split('decideProgrammaticNavigation(userOrigin, targetUrl)').length - 1;
    expect(hits).toBe(1);
  });

  /**
   * 外部审查 T11 · 页面静默落盘。
   * 实测：不挂 `will-download` 时，第三方页面的附件下载**不经任何询问**就写进系统"下载"目录
   * （探针里两个 20 字节的 .tmp 文件就这么出现了，界面与状态栏一声不响）。
   * 本项目没有"下载管理"这套产品，所以一律拦下并把理由留在状态里。
   */
  it('网页发起的下载被取消，且理由可见、监听器会摘干净', () => {
    expect(browserSource).toContain("on('will-download'");
    expect(browserSource).toContain('item.cancel()');
    expect(browserSource).toContain('blocked = { url: item.getURL(), reason: downloadReason }');
    // 会话级监听器挂在**共享的 default session** 上：不摘就会随每次开合累积（重复处理 + 泄漏）
    expect(browserSource).toContain("off('will-download'");
  });

  it('退出时销毁浏览器视图（不留孤儿 webContents）', () => {
    expect(ipcSource).toContain('browser.dispose()');
  });

  it('每条浏览器通道都在统一入口后面注册（新通道默认受发送方校验保护）', () => {
    const channels = [
      'BROWSER_OPEN_WITH',
      'BROWSER_BACK',
      'BROWSER_FORWARD',
      'BROWSER_RELOAD',
      'BROWSER_CLOSE',
      'BROWSER_SET_BOUNDS',
      'BROWSER_GET_TEXT',
      'BROWSER_STATE',
      'BROWSER_EXE_PICK',
      'BROWSER_EXE_GET',
      'BROWSER_EXE_SET',
    ];
    for (const name of channels) {
      // 必须是 `handle(IPC.X` 开头 —— 直接写 ipcMain.handle 会绕开发送方校验
      expect(ipcSource).toContain(`handle(IPC.${name},`);
    }
    // 反向锁：本模块绝不能出现裸 ipcMain.handle（绕过统一入口 = 绕过安全默认值）
    const bare = ipcSource.match(/ipcMain\.handle\(/g) ?? [];
    expect(bare.length).toBe(0); // 唯一的裸入口在 ipc/handle.ts，由 ipc-wiring.test.ts 锁
  });
});

describe('打开方式三档（M10 收尾）：外发动作的接线锁', () => {
  const gateSource = stripComments(readFileSync(join(here, 'open-with-gate.ts'), 'utf8'));
  const serviceSource = stripComments(readFileSync(join(here, 'open-with-service.ts'), 'utf8'));
  const launchSource = stripComments(readFileSync(join(here, 'open-with-launch.ts'), 'utf8'));

  it('IPC 层不自己判档：判档只活在 open-with-gate.ts 一处', () => {
    // 就地判档 = 变异咬不到、单测也测不动的那一类老毛病（与 config-write、git-gate 同一教训）
    expect(ipcSource).toContain('createOpenWithService(');
    expect(ipcSource).toContain('openWith.openWith(');
    expect(ipcSource).not.toContain('decideGate(');
    expect(serviceSource).not.toContain('decideGate(');
    expect((gateSource.match(/decideGate\(/g) ?? []).length).toBe(1);
  });

  it('硬 ask 的落地只有一处，且写的是 false（M17 的靶子）', () => {
    expect((gateSource.match(/bypassable: false/g) ?? []).length).toBe(1);
    expect(gateSource).not.toContain('bypassable: true');
  });

  it('服务层没有任何"记住"这条路：不存在 remembered / alwaysAllow 缓存', () => {
    // 两档都是硬 ask，一次授权只覆盖一次交付 —— 记下来就等于把它变成软 ask
    expect(serviceSource).not.toMatch(/remembered|alwaysAllow|allow_always/);
  });

  it('真正交给本机的动作只在 open-with-launch.ts，且永不经过 shell', () => {
    expect(launchSource).toContain('spawn(exePath, buildProgramArgs(url)');
    expect(launchSource).toContain('shell: false');
    expect(launchSource).not.toContain('shell: true');
    // 参数只有一个网址：拼任何开关、命令或前缀都要先过这一关
    expect(launchSource).toContain('return [url];');
    // 运行时接进去的是真实现，而不是留着某个测试假实现上线
    expect(ipcSource).toContain('...createRealLaunchers()');
  });

  it('自选程序：只有对话框那条能写路径，SET 只能清空', () => {
    const pickRegion = ipcSource.slice(ipcSource.indexOf('handle(IPC.BROWSER_EXE_PICK'));
    const setRegion = pickRegion.slice(pickRegion.indexOf('handle(IPC.BROWSER_EXE_SET'));
    expect(pickRegion.slice(0, pickRegion.indexOf('handle(IPC.BROWSER_EXE_SET'))).toContain('openWith.acceptPickedExe(');
    expect(setRegion).toContain('openWith.clearExePath()');
    // 反向：SET 那段绝不能调 acceptPickedExe —— 那等于把"选程序"的授权交回渲染层
    expect(setRegion).not.toContain('acceptPickedExe(');
    // 而且 SET 的入参先过"只收 null"的契约
    expect(setRegion).toContain('browserExeClearSchema.safeParse(');
  });

  it('网址先过浏览器策略层，再谈权限（越界输入不该有机会弹到用户面前求确认）', () => {
    expect(serviceSource).toContain('decideNavigation(url)');
    const openRegion = serviceSource.slice(serviceSource.indexOf('const openWith = async'));
    expect(openRegion.indexOf('safeUrl(url)')).toBeLessThan(openRegion.indexOf('loadPolicy()'));
  });

  it('外部两档的确认走的是同一个审批桥（不给自己另开一条"更容易批"的路）', () => {
    expect(ipcSource).toContain('resolvePermission: (req) => deps.permission.resolve(req)');
  });

  it('内置档回给界面的状态一律**现读**（复核 030 的 N-1：旧快照会把"被拦"广播盖掉）', () => {
    // 导航结果里那份 state 是 navigate() **内部**取的快照；只要响应路径上再多一个 await
    // （本轮多的是写默认档），被拦广播就会先到、后被这份旧快照覆盖 → 拒绝理由静默消失。
    expect(ipcSource).not.toContain('state: result.state');
    expect((ipcSource.match(/state: browser\.state\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
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
