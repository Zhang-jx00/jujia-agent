import { ipcMain, app } from 'electron';
import { IPC, appInfoSchema, type AppInfo } from '@jujia/shared-ipc';
import { getDataRoot } from './paths';

/**
 * 注册 main 侧 IPC handler。
 * 约定：每个 handler 的返回值都必须过一遍 zod 校验，避免契约悄悄漂移。
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.APP_INFO, (): AppInfo => {
    const payload: AppInfo = {
      name: '俱佳Agent',
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      platform: process.platform,
      security: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
      dataRoot: getDataRoot(),
    };
    return appInfoSchema.parse(payload);
  });
}
