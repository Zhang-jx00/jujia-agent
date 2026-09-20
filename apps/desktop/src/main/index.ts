import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC, type StreamEvent } from '@jujia/shared-ipc';
import { registerIpcHandlers } from './ipc';
import { ensureConfigFile } from './config-store';
import { getDataRoot } from './paths';
import {
  applySecurityBaseline,
  assertSecureWebPreferences,
  openExternalIfSafe,
  secureWebPreferences,
} from './security';
import { makeStreamSender, PermissionBridge } from './permission-bridge';

/**
 * 权限审批桥：把 agent-core 的权限询问接到渲染层弹窗。
 * 超时与「窗口消失」都必须有确定结局，不能留下无上界的等待。
 */
const permissionBridge = new PermissionBridge({
  send: makeStreamSender(() => mainWindow),
});

// 固定应用名：让 userData 路径可预期（%APPDATA%\JujiaAgent），避免随包名变化漂移
app.setName('JujiaAgent');

const isSmoke = process.argv.includes('--smoke');
/** 启动性能实测模式（M18）：打印启动时间线后退出，用于建立可回归的性能预算 */
const isPerf = process.argv.includes('--perf');

/**
 * 启动时间线（M18）。用真实打点而不是估算：
 * app 进程起点 → whenReady → 窗口创建 → 渲染层加载完成 → 渲染层首帧（由 renderer 回报）。
 * 预算：冷启动 < 1500ms、可交互（首帧）< 1000ms。见 docs/PERF-BUDGET.md。
 */
const perfStart = Date.now();
const perfMarks: Array<{ name: string; ms: number }> = [];
function perfMark(name: string): void {
  perfMarks.push({ name, ms: Date.now() - perfStart });
}
perfMark('main:start');
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

/** 当前主窗口引用：流式事件推送与窗口重建都依赖它 */
let mainWindow: BrowserWindow | undefined;

/** 把流式事件安全地推给渲染层（窗口已销毁时静默丢弃，避免抛错） */
function emitStream(event: StreamEvent): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.CHAT_STREAM, event);
}

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
  mainWindow = win;
  perfMark('main:window-created');

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });

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

/**
 * W3 端到端断言：工作区读取 + 工具执行链路在真实运行时可用。
 * 未选择工作区时必须给出**可读的中文提示**，而不是抛错或静默失败。
 */
async function runSmokeWorkspaceProbe(
  win: BrowserWindow,
): Promise<{ workspaceRoot: string | null; toolOk: boolean; toolMessage: string }> {
  const [workspaceRoot, toolOk, toolMessage] = (await win.webContents.executeJavaScript(
    `(async () => {
       const ws = await window.jujia.workspaceGet();
       const tr = await window.jujia.toolRun('list_dir', {});
       return [ws.root, tr.ok, tr.content.slice(0, 80)];
     })()`,
  )) as [string | null, boolean, string];
  return { workspaceRoot, toolOk, toolMessage };
}

/** 冒烟检查：渲染层必须「拿得到 IPC 结果」且「碰不到 Node 能力」。 */
async function runSmoke(win: BrowserWindow): Promise<{ configVersion: string; configSource: string }> {
  // did-finish-load 早于 React 首帧与 IPC 回包，需要轮询等待（实测 2026-09-18）
  const deadline = Date.now() + 8_000;
  let marker = 'missing';
  let nodeLeak = false;
  let configVersion = '';
  let configSource = '';

  while (Date.now() < deadline) {
    const result = (await win.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector('[data-smoke]');
         return [
           el?.getAttribute('data-smoke') ?? 'missing',
           typeof window.require !== 'undefined' || typeof window.process !== 'undefined'
             || typeof window.module !== 'undefined',
           el?.getAttribute('data-config-version') ?? '',
           el?.getAttribute('data-config-source') ?? '',
         ];
       })()`,
    )) as [string, boolean, string, string];

    [marker, nodeLeak, configVersion, configSource] = result;

    if (marker === 'ok' || marker === 'error') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (marker !== 'ok') throw new Error(`渲染层未就绪或 IPC 失败（marker=${marker}）`);
  if (nodeLeak) throw new Error('检测到 Node 全局对象泄漏到渲染层');
  if (!configVersion) throw new Error('配置读取链路未打通（data-config-version 为空）');

  return { configVersion, configSource };
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

  /**
   * 冒烟看门狗：必须在任何 await 之前注册。
   *
   * 复核发现（2026-09-18 第二遍）：初版把超时定时器放在 `await ensureConfigFile()` 之后，
   * 一旦启动阶段抛错（未捕获的 Promise rejection），进程既没有窗口也没有定时器，
   * 会变成永不退出的僵尸进程（实测挂死 7 分钟）。
   */
  const smokeWatchdog = isSmoke
    ? setTimeout(() => {
        console.error('SMOKE FAIL: 启动流程 20s 内未完成（可能卡在启动阶段）');
        app.exit(1);
      }, 20_000)
    : undefined;

  void app
    .whenReady()
    .then(async () => {
      // 渲染层首帧回报（仅 perf 模式用到，但保持恒注册以免契约漂移）
      ipcMain.handle(IPC.PERF_FIRST_PAINT, () => {
        perfMark('renderer:first-paint');
        if (isPerf) {
          const budget = { coldStartMs: 1500, interactiveMs: 1000 };
          const total = Date.now() - perfStart;
          const lines = perfMarks.map((m) => `  ${String(m.ms).padStart(6)}ms  ${m.name}`);
          const firstPaint = perfMarks.find((m) => m.name === 'renderer:first-paint');
          const ok = total <= budget.coldStartMs && (firstPaint?.ms ?? Infinity) <= budget.interactiveMs;
          console.log(
            `PERF ${ok ? 'OK' : 'FAIL'}: 启动时间线（预算 冷启动<${budget.coldStartMs}ms / 可交互<${budget.interactiveMs}ms）\n${lines.join('\n')}\n  合计 ${total}ms · 首帧 ${firstPaint?.ms ?? -1}ms`,
          );
          setTimeout(() => app.exit(ok ? 0 : 1), 50);
        }
        return true;
      });

      registerIpcHandlers({
        emitStream,
        permission: permissionBridge,
        getWindow: () => mainWindow,
      });

      // 首次启动落盘默认配置（原子写），使「写 → 备份 → 损坏恢复」链路在运行时真实可达
      const snapshot = await ensureConfigFile();
      console.log(
        `[main] 数据根目录: ${getDataRoot()} · 配置 v${snapshot.version} (${snapshot.source})` +
          (snapshot.recovered
            ? ` · ⚠ 本次启动已从${snapshot.recoveredFrom === 'backup' ? '备份 .bak' : '默认值'}恢复（${snapshot.recoveredAt ?? '未知时间'}）`
            : ''),
      );

      const win = createMainWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      });

      if (!isSmoke) return;

      win.webContents.once('did-finish-load', () => {
    perfMark('main:did-finish-load');
        runSmoke(win)
          .then(async ({ configVersion, configSource }) => {
            const probe = await runSmokeWorkspaceProbe(win);
            if (smokeWatchdog) clearTimeout(smokeWatchdog);

            // 未选择工作区时，工具必须给出可读提示而不是抛错/静默
            if (probe.workspaceRoot === null) {
              if (probe.toolOk || !probe.toolMessage.includes('工作区')) {
                console.error(`SMOKE FAIL: 未选工作区时工具行为不符预期 → ${probe.toolMessage}`);
                app.exit(1);
                return;
              }
            }

            if (process.env['JJ_PERF_TRACE'] === '1') {
              console.log('启动时间线:', perfMarks.map((m) => `${m.name}=${m.ms}ms`).join(' · '));
            }
            console.log(
              'SMOKE OK: 主进程 + 预加载桥 + 渲染层 + IPC 全链路就绪；' +
                `渲染层无 Node 泄漏；原子配置读取成功（v${configVersion} / ${configSource}）；` +
                `工作区工具链路可用（工作区=${probe.workspaceRoot ?? '未选择'}，list_dir=${probe.toolOk ? 'ok' : '已拦截'}）`,
            );
            app.exit(0);
          })
          .catch((err: unknown) => {
            if (smokeWatchdog) clearTimeout(smokeWatchdog);
            console.error('SMOKE FAIL:', err instanceof Error ? err.message : err);
            app.exit(1);
          });
      });
    })
    .catch((err: unknown) => {
      // 启动阶段任何异常都必须可见并 fail fast，绝不留下无窗口的僵尸进程
      console.error('[main] 启动失败:', err instanceof Error ? err.message : err);
      if (smokeWatchdog) clearTimeout(smokeWatchdog);
      app.exit(1);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
