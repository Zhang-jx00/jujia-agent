import { ipcMain, app } from 'electron';
import {
  IPC,
  appConfigSchema,
  appInfoSchema,
  configSnapshotSchema,
  type AppConfig,
  type AppInfo,
  type ConfigSnapshot,
} from '@jujia/shared-ipc';
import { getDataRoot } from './paths';
import { readConfigSnapshot, writeConfig } from './config-store';

/**
 * 注册 main 侧 IPC handler。
 * 约定：入参与出参都必须过 zod 校验，避免契约悄悄漂移。
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

  ipcMain.handle(IPC.CONFIG_GET, async (): Promise<ConfigSnapshot> => {
    return configSnapshotSchema.parse(await readConfigSnapshot());
  });

  ipcMain.handle(IPC.CONFIG_SET, async (_e, patch: unknown): Promise<ConfigSnapshot> => {
    // 只接受已知字段，防止渲染层塞任意键污染配置；
    // 显式剔除 undefined 以配合 exactOptionalPropertyTypes
    const parsed = appConfigSchema.partial().parse(patch);
    const clean: Partial<AppConfig> = {};
    if (parsed.theme !== undefined) clean.theme = parsed.theme;
    if (parsed.workspace !== undefined) clean.workspace = parsed.workspace;
    return configSnapshotSchema.parse(await writeConfig(clean));
  });
}
