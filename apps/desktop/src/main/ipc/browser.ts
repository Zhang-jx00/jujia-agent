import { app, dialog } from 'electron';
import {
  IPC,
  browserBoundsSchema,
  browserExeClearSchema,
  browserExePickResultSchema,
  browserExeStateSchema,
  browserOpenWithResultSchema,
  browserOpenWithSchema,
  browserStateSchema,
  browserTextResultSchema,
  type BrowserState,
} from '@jujia/shared-ipc';import { createBrowserService } from '../browser-service';
import { writeConfig } from '../config-store';
import { checkExePath, createFileExePathStore, createOpenWithService } from '../open-with-service';
import { createRealLaunchers } from '../open-with-launch';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * 内置浏览器（M10）。
 *
 * 视图状态（开没开、用户所选 origin、最近一次被拒理由）全留在主进程，
 * 渲染层只拿状态快照 —— 第三方网页永远拿不到能力桥（e2e 第 14 步有运行时探针证明这点）。
 *
 * 为什么浏览器导航**不另设一道审批弹窗**（所有者已拍板）：地址是用户自己敲的，那次输入就是本次导航的授权，
 * 再弹一次是重复索求、会催生"随手点允许"（审批疲劳）。真正要拦的是**页面自己发起的跳转**，
 * 那由 `browser-service` 的 `will-navigate` 策略处理：既过协议白名单，也不许跳出用户所选站点。
 *
 * **而"交给外部程序"是另一回事**（M10 收尾 · 所有者 2026-09-26 批复）：地址一离开本应用，
 * 上面那四层防线就都不跟着管了。所以 `system` / `custom` 两档**每次过硬 ask**，
 * 判档在 `open-with-gate.ts`。自选程序的路径**只能由这里的原生文件对话框选定** ——
 * 渲染层能写的只有"默认预选哪一档"（那只是下拉框的位置，不是授权）。
 */
export function registerBrowserIpc(ctx: IpcContext): void {
  const { handle, deps, loadPolicy, audit } = ctx;

  const browser = createBrowserService({
    getWindow: () => deps.getWindow?.(),
    onChanged: (next) => {
      deps.getWindow?.()?.webContents.send(IPC.BROWSER_STATE_CHANGED, next);
    },
  });
  // 退出时销毁，不留孤儿 webContents
  app.on('before-quit', () => {
    browser.dispose();
  });

  /**
   * 内置视图的导航（**只由 `BROWSER_OPEN_WITH` 的 internal 档调用**）。
   *
   * 原先这里另开过两条通道（`BROWSER_OPEN` / `BROWSER_NAVIGATE`）供界面直接调。
   * 三档打开方式落地后它们就成了"同一件事的两个入口"：界面绕不绕得开选档，
   * 取决于它调哪一条 —— 这正是会被误用多年的那种形状。
   * 现在**只有一个动作、一条通道**：`browser:open-with`，档位决定要不要过人手。
   *
   * **返回的 state 一律现读**（不用 `navigate()` 内部那份快照）。
   * 这不是洁癖：本轮在响应之前多加了一次配置写入，于是"页面自发跳转被拦"的广播
   * 先到达、这份**旧快照**后到达并把它盖掉 —— e2e 第 15 步当场变红（复核 030 的 N-1）。
   * 快照的相对新旧取决于中间隔了几个 await，而这种 await 只会越加越多。
   */
  const navigateInternal = async (url: string): Promise<{ ok: boolean; reason: string | null }> => {
    const result = browser.state().open ? await browser.navigate(url) : await browser.open(url);
    return { ok: result.ok, reason: result.reason ?? '导航被拒绝' };
  };

  handle(IPC.BROWSER_BACK, async (): Promise<BrowserState> => browserStateSchema.parse(browser.back()));

  handle(IPC.BROWSER_FORWARD, async (): Promise<BrowserState> =>
    browserStateSchema.parse(browser.forward()),
  );

  handle(IPC.BROWSER_RELOAD, async (): Promise<BrowserState> =>
    browserStateSchema.parse(browser.reload()),
  );

  handle(IPC.BROWSER_CLOSE, async (): Promise<BrowserState> => {
    browser.close();
    return browserStateSchema.parse(browser.state());
  });

  /** 渲染层上报占位区位置；尺寸非法时只返回 false，不去动视图（宁可不显示，不要显示成半个） */
  handle(IPC.BROWSER_SET_BOUNDS, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = browserBoundsSchema.safeParse(payload);
    if (!parsed.success) return false;
    browser.setBounds(parsed.data);
    return true;
  });

  /** 读正文交给模型（只读；上限截断会如实标 truncated） */
  handle(IPC.BROWSER_GET_TEXT, async () => browserTextResultSchema.parse(await browser.getText()));

  handle(IPC.BROWSER_STATE, async (): Promise<BrowserState> =>
    browserStateSchema.parse(browser.state()));

  /* ---------------- 打开方式三档（M10 收尾） ---------------- */

  const openWith = createOpenWithService({
    loadPolicy,
    resolvePermission: (req) => deps.permission.resolve(req),
    getWorkspaceRoot: async () => (await getWorkspaceInfo()).root,
    ...createRealLaunchers(),
    exeStore: createFileExePathStore(),
    audit,
  });

  /** 三档统一入口：界面只有一个"打开"按钮，返回形状也只有一个 */
  handle(IPC.BROWSER_OPEN_WITH, async (_e, payload: unknown) => {
    const parsed = browserOpenWithSchema.safeParse(payload);
    if (!parsed.success) {
      return browserOpenWithResultSchema.parse({
        ok: false,
        target: 'internal',
        asked: false,
        decision: null,
        state: browser.state(),
        error: '网址或打开方式不合法（网址上限 2048，档位只有 internal/system/custom）',
      });
    }
    if (parsed.data.target === 'internal') {
      const result = await navigateInternal(parsed.data.url);
      // 内置那一档的被拒理由来自安全基线，原样带回界面（不润色成"打开失败"）
      if (!result.ok) {
        return browserOpenWithResultSchema.parse({
          ok: false,
          target: 'internal',
          asked: false,
          decision: null,
          state: browser.state(),
          error: result.reason,
        });
      }
      await writeConfig({ browserOpenWith: 'internal' });
      return browserOpenWithResultSchema.parse({
        ok: true,
        target: 'internal',
        asked: false,
        decision: null,
        // 现读：被拦广播可能已经先到了，拿旧快照盖掉它就会把"为什么没跳"抹平
        state: browser.state(),
        error: null,
      });
    }
    const outcome = await openWith.openWith(parsed.data.target, parsed.data.url);
    if (outcome.ok) {
      // "选择后记住为默认"由**主进程**落盘：只有真的打开成功才算一次选择，
      // 而且省掉渲染层的读-改-写竞态（它同时还会写 theme / permissionMode）。
      await writeConfig({ browserOpenWith: outcome.target });
      return browserOpenWithResultSchema.parse({
        ok: true,
        target: outcome.target,
        asked: outcome.asked,
        decision: outcome.decision,
        state: null,
        error: null,
      });
    }
    return browserOpenWithResultSchema.parse({
      ok: false,
      target: parsed.data.target,
      asked: false,
      decision: null,
      state: browser.state(),
      error: outcome.error,
    });
  });

  /** 自选程序：**只有这条通道能写入路径**，且路径来自原生对话框，不是渲染层填的 */
  handle(IPC.BROWSER_EXE_PICK, async () => {
    const options = {
      title: '选择用来打开网页的浏览器程序',
      buttonLabel: '就用这个程序',
      properties: ['openFile'] as ['openFile'],
    };
    const owner = deps.getWindow?.();
    const picked = owner === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(owner, options);
    if (picked.canceled || picked.filePaths.length === 0) {
      return browserExePickResultSchema.parse({
        ok: false,
        path: await openWith.currentExePath(),
        error: '已取消选择，保持原样（未做任何改动）',
      });
    }
    const first = picked.filePaths[0] ?? '';
    const accepted = await openWith.acceptPickedExe(first);
    return accepted.ok
      ? browserExePickResultSchema.parse({
          ok: true,
          path: accepted.path,
          message: '已记住这个程序。每次用它打开网页仍会逐次确认 —— 记住的是路径，不是授权。',
        })
      : browserExePickResultSchema.parse({
          ok: false,
          path: await openWith.currentExePath(),
          error: accepted.error,
        });
  });

  handle(IPC.BROWSER_EXE_GET, async () => {
    const path = await openWith.currentExePath();
    if (path === null) return browserExeStateSchema.parse({ path: null, usable: false });
    // 每次现查文件是否还在：用户把浏览器卸载了、挪走了，界面不能继续显示"已就绪"
    const check = await checkExePath(path, (await getWorkspaceInfo()).root);
    return browserExeStateSchema.parse({ path, usable: check.ok });
  });

  /** 清除自选程序。契约是 `.strict()` 且只收 `{path: null}` —— 想设路径得走对话框那条 */
  handle(IPC.BROWSER_EXE_SET, async (_e, payload: unknown) => {
    const parsed = browserExeClearSchema.safeParse(payload);
    if (!parsed.success) {
      return browserExePickResultSchema.parse({
        ok: false,
        path: await openWith.currentExePath(),
        error: '自选程序只能由本机文件对话框选定或清空，界面不能直接填路径',
      });
    }
    await openWith.clearExePath();
    return browserExePickResultSchema.parse({
      ok: true,
      // 清除之后的真实状态就是"没有路径"，这里返回 null 而不是空串 —— 界面据此提示重新选择
      path: null,
      message: '已清除自选程序（下次选档时会提示重新选择）',
    });
  });
}
