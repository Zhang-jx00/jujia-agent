import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  appInfoSchema,
  configSnapshotSchema,
  type AppConfig,
  type AppInfo,
  type ConfigSnapshot,
} from '@jujia/shared-ipc';

/**
 * 渲染层唯一可用的能力面。
 * 纪律：只暴露具体方法（一方法一通道），绝不暴露 ipcRenderer 本体。
 */
const api = {
  async appInfo(): Promise<AppInfo> {
    const raw: unknown = await ipcRenderer.invoke(IPC.APP_INFO);
    return appInfoSchema.parse(raw);
  },

  async configGet(): Promise<ConfigSnapshot> {
    const raw: unknown = await ipcRenderer.invoke(IPC.CONFIG_GET);
    return configSnapshotSchema.parse(raw);
  },

  async configSet(patch: Partial<AppConfig>): Promise<ConfigSnapshot> {
    const raw: unknown = await ipcRenderer.invoke(IPC.CONFIG_SET, patch);
    return configSnapshotSchema.parse(raw);
  },
};

export type JujiaApi = typeof api;

contextBridge.exposeInMainWorld('jujia', api);
