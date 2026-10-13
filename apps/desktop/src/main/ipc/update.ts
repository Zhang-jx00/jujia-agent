import { app, net } from 'electron';
import { IPC, updateCheckResultSchema } from '@jujia/shared-ipc';
import { createUpdateService } from '../update-service';
import type { IpcContext } from './context';

/**
 * 更新检查（M12 批二 · R11）。
 *
 * **只读的一次查询**：GET 一眼发布信息，把"有没有新版本 + 发布页地址"回报给界面 ——
 * 不下载、不执行、不写任何文件（这条由接线锁扫源码钉住）。
 * 生产请求走 Electron 的 `net`（系统代理设置生效）；测试面由 `deps.fetcher` 注入，
 * e2e 面由 `JUJIA_UPDATE_API` 指向本地服务器 —— 两条注入路径都只换"问谁"，不换"问什么"。
 */
export function registerUpdateIpc(ctx: IpcContext): void {
  const { handle, deps } = ctx;

  handle(IPC.APP_UPDATE_CHECK, async () => {
    const fetchImpl: typeof fetch =
      deps.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => net.fetch(input as string, init));
    const apiUrl = process.env['JUJIA_UPDATE_API'];
    const service = createUpdateService({
      currentVersion: app.getVersion(),
      fetchImpl,
      ...(apiUrl !== undefined && apiUrl !== '' ? { apiUrl } : {}),
    });
    return updateCheckResultSchema.parse(await service.check());
  });
}
