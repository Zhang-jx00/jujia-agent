import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc';
import {
  applySecurityBaseline,
  assertSecureWebPreferences,
  openExternalIfSafe,
  secureWebPreferences,
} from './security';

const isSmoke = process.argv.includes('--smoke');
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

function createMainWindow(): BrowserWindow {
  const webPreferences = secureWebPreferences(join(__dirname, '../preload/index.js'));
  assertSecureWebPreferences(webPreferences);

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#141414',
    title: '俱佳Agent',
    autoHideMenuBar: true,
    webPreferences,
  });

  applySecurityBaseline(win, { devServerUrl });

  win.once('ready-to-show', () => {
    if (!isSmoke) win.show();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] 渲染进程异常退出:', details.reason);
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/** 冒烟检查：渲染层必须「拿得到 IPC 结果」且「碰不到 Node 能力」。 */
async function runSmoke(win: BrowserWindow): Promise<void> {
  // did-finish-load 早于 React 首帧与 IPC 回包，需要轮询等待（实测 2026-09-18）
  const deadline = Date.now() + 8_000;
  let marker = 'missing';
  let nodeLeak = false;

  while (Date.now() < deadline) {
    [marker, nodeLeak] = (await win.webContents.executeJavaScript(
      `[
         document.querySelector('[data-smoke]')?.getAttribute('data-smoke') ?? 'missing',
         typeof window.require !== 'undefined' || typeof window.process !== 'undefined'
           || typeof window.module !== 'undefined'
       ]`,
    )) as [string, boolean];

    if (marker === 'ok' || marker === 'error') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (marker !== 'ok') throw new Error(`渲染层未就绪或 IPC 失败（marker=${marker}）`);
  if (nodeLeak) throw new Error('检测到 Node 全局对象泄漏到渲染层');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfSafe(url);
      return { action: 'deny' };
    });
  });

  void app.whenReady().then(() => {
    registerIpcHandlers();
    const win = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });

    if (!isSmoke) return;

    const timeout = setTimeout(() => {
      console.error('SMOKE FAIL: 渲染层 20s 内未完成加载');
      app.exit(1);
    }, 20_000);

    win.webContents.once('did-finish-load', () => {
      runSmoke(win)
        .then(() => {
          clearTimeout(timeout);
          console.log('SMOKE OK: 主进程 + 预加载桥 + 渲染层 + IPC 全链路就绪，且渲染层无 Node 泄漏');
          app.exit(0);
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          console.error('SMOKE FAIL:', err instanceof Error ? err.message : err);
          app.exit(1);
        });
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
