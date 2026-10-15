import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createLogRecord } from '@jujia/agent-core';
import { IPC, type StreamEvent } from '@jujia/shared-ipc';
import { registerIpcHandlers } from './ipc';
import { ensureConfigFile } from './config-store';
import { getDataRoot } from './paths';
import { createLogStore } from './log-store';
import { createLogger, resolveDefaultMinLevel } from './logger';
import { setPersistLogger } from './chat-service';
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

/**
 * 结构化日志（M12 批一 · R10）。
 *
 * 这一本文件的读者是"出了事之后的自己"：启动线（数据根 / 配置来源 / 恢复）、
 * 渲染进程崩溃、启动失败、渲染层兜底上报全部落这里。
 * **构造即剔密**（`createLogRecord` 是唯一入口），**写坏不抛穿**（失败在 status 里数得出），
 * **不出本机**（只有文件这一条路，没有任何网络路径）。
 */
const logs = createLogStore({ dir: join(getDataRoot(), 'logs'), clock: () => new Date() });
const logger = createLogger(logs, { minLevel: resolveDefaultMinLevel(process.env) });
// T47：把失败出口交给对话链路。不调这一句，chat-service 里那六处失败就只进 console ——
// 而**打包后的 Electron 里 console 不进任何文件**，"落盘失败只进 console"正是 2026-10-09 审计的原话。
setPersistLogger(logger);

const isSmoke = process.argv.includes('--smoke');
/**
 * 无头 = smoke 或 shoot（R32 展示页截图）。
 *
 * 为什么要并进同一个开关而不是再写一条 `if`：这两件事的**后果完全一样** —— 窗口不弹到用户脸上，
 * 但渲染层照常画（`show:false` + `ready-to-show` 之后 `capturePage` 拿得到内容）。
 * 分成两条 `if (!isSmoke) ... else if (isShoot) ...` 的结局是将来加第三种模式时只改一边，
 * 于是"截图脚本把窗口弹出来"这种退化会在某一天悄悄发生（源锁 `headless-shoot-wiring` 就盯这个）。
 */
const isShoot = process.argv.includes('--shoot');
const isHeadless = isSmoke || isShoot;
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
  /**
   * 展示页截图（R32）走 **offscreen 渲染**，而不是"建个正常窗口再藏起来"：
   * 隐藏窗口不保证每一帧都画，抓到的像素可能是黑的或旧的 ——
   * 而"截图看起来成功了、内容是黑的"正是这条门禁最没用的失败方式。
   * `offscreen` 是 Electron 给"没人看也要画"的官方路径（在 44 的类型里它**只在 `WebPreferences` 上**，
   * 写在 BrowserWindow 顶层会直接 TS2353 —— 本轮实测撞过一次）。
   *
   * **必须经过 `secureWebPreferences` 这个出口**：那正是安全基线的 fail-closed 断言所在，
   * 在这里手拼一份 `webPreferences` 就等于绕过它（本仓的老账：基线被顺手复制粘贴掉）。
   * 只有 shoot 模式开 —— 日常窗口要是也 offscreen，症状是"双击图标什么都没发生"。
   */
  const webPreferences = secureWebPreferences(join(__dirname, '../preload/index.js'), { offscreen: isShoot });
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

  applySecurityBaseline(win, { devServerUrl, rendererDir: join(__dirname, '../renderer') });
  mainWindow = win;
  perfMark('main:window-created');

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
    /**
     * 窗口销毁后，**把所有挂起的审批请求立即收尾**（轨道回归计划 1 修 M2/E5）。
     *
     * 此前 `PermissionBridge.cancelAll` 定义了却**从未被调用**：注释承诺"窗口销毁立即收尾"，
     * 实际只能等满 120 秒超时 —— 工具调用链路会悬在那里，用户重开窗口也看不到任何反馈。
     * 这类"注释即承诺、代码没兑现"的问题，正是排查报告点名的一类。
     */
    permissionBridge.cancelAll('窗口已关闭');
  });

  win.once('ready-to-show', () => {
    if (!isHeadless) win.show();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] 渲染进程异常退出:', details.reason);
    // 落一本日志：这条以前只进控制台（打包之后谁都看不见），而"界面崩了"正是最需要事后查的事
    logger.error('app', '渲染进程异常退出', { reason: details.reason });
    /**
     * T38：崩溃也要收尾挂起的审批。
     *
     * `permission-bridge.ts` 的头部契约一开始就写了两条（窗口销毁 / 渲染进程崩溃），
     * 代码只接了第一条 —— 于是弹窗随渲染进程一起消失后，工具调用还挂在那里等满 120 秒。
     * 理由里带上 `details.reason`：审计与日志要分得开"用户没答"和"没人在答"，
     * 把崩溃记成超时是**让后果盖掉事实**。
     */
    permissionBridge.cancelAll(`渲染进程已退出（${details.reason}）`);
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
        logs,
      });

      // 启动时轮转：清掉保留期之外的旧日志；**删了谁要说出来**（轮转不静默）
      void logs.prune(7).then(({ removed }) => {
        if (removed.length > 0) {
          logger.info('app', `日志轮转：删除 ${String(removed.length)} 个过期文件`, {
            removed: removed.join(', '),
          });
        }
      });

      // 首次启动落盘默认配置（原子写），使「写 → 备份 → 损坏恢复」链路在运行时真实可达
      const snapshot = await ensureConfigFile();
      console.log(
        `[main] 数据根目录: ${getDataRoot()} · 配置 v${snapshot.version} (${snapshot.source})` +
          (snapshot.recovered
            ? ` · ⚠ 本次启动已从${snapshot.recoveredFrom === 'backup' ? '备份 .bak' : '默认值'}恢复（${snapshot.recoveredAt ?? '未知时间'}）`
            : ''),
      );
      // 启动这条记录把"这次用的是哪份数据、配置从哪儿来、有没有自愈过"钉在日志里
      logger.info('app', '启动', {
        dataRoot: getDataRoot(),
        configVersion: snapshot.version,
        source: snapshot.source,
        recovered: snapshot.recovered,
      });

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
    .catch(async (err: unknown) => {
      // 启动阶段任何异常都必须可见并 fail fast，绝不留下无窗口的僵尸进程。
      // 日志这条**等写完再退出**：`app.exit` 不等异步写 —— 若发射后不管，
      // 这条最该被看到的记录恰恰永远到不了盘上（与 will-quit 那次同形的坑）。
      const message = err instanceof Error ? err.message : String(err);
      console.error('[main] 启动失败:', message);
      await logs.append(createLogRecord({ level: 'error', scope: 'app', msg: `启动失败：${message}` }, () => new Date()));
      if (smokeWatchdog) clearTimeout(smokeWatchdog);
      app.exit(1);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
