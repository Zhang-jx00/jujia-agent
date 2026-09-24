import { app } from 'electron';
import {
  IPC,
  browserBoundsSchema,
  browserNavResultSchema,
  browserStateSchema,
  browserTextResultSchema,
  browserUrlSchema,
  type BrowserState,
} from '@jujia/shared-ipc';
import { createBrowserService } from '../browser-service';
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
 */
export function registerBrowserIpc(ctx: IpcContext): void {
  const { handle, deps } = ctx;

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

  const browserNavigate = async (
    payload: unknown,
    go: (url: string) => Promise<{ ok: boolean; reason?: string; state: BrowserState }>,
  ): Promise<unknown> => {
    const parsed = browserUrlSchema.safeParse(payload);
    if (!parsed.success) {
      return browserNavResultSchema.parse({
        ok: false,
        reason: '网址不合法（长度或形态不对）',
        state: browser.state(),
      });
    }
    const result = await go(parsed.data.url);
    return browserNavResultSchema.parse(
      result.ok
        ? { ok: true, state: result.state }
        : { ok: false, reason: result.reason ?? '导航被拒绝', state: result.state },
    );
  };

  handle(IPC.BROWSER_OPEN, async (_e, payload: unknown) =>
    browserNavigate(payload, (url) => browser.open(url)),
  );

  handle(IPC.BROWSER_NAVIGATE, async (_e, payload: unknown) =>
    browserNavigate(payload, (url) => browser.navigate(url)),
  );

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
}
