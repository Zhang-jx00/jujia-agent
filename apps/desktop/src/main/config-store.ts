import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import {
  appConfigSchema,
  configSnapshotSchema,
  defaultAppConfig,
  type AppConfig,
  type ConfigSnapshot,
} from '@jujia/shared-ipc';
import { getDataRoot } from './paths';

/** 当前配置 schema 版本。字段变更时必须 +1 并在 migrate 中处理旧版本。 */
export const CONFIG_VERSION = 1;

let store: JsonStore<AppConfig> | undefined;

export function getConfigStore(): JsonStore<AppConfig> {
  store ??= new JsonStore<AppConfig>(join(getDataRoot(), 'config.json'), {
    version: CONFIG_VERSION,
    defaults: defaultAppConfig,
    validate: (input) => appConfigSchema.parse(input),
  });
  return store;
}

/** 读取配置快照（含来源与恢复标记，UI 需如实展示） */
export async function readConfigSnapshot(): Promise<ConfigSnapshot> {
  const res = await getConfigStore().read();
  const snapshot: ConfigSnapshot = {
    config: res.data,
    version: res.detectedVersion ?? CONFIG_VERSION,
    source: res.source,
    recovered: res.recovered,
  };
  return configSnapshotSchema.parse(snapshot);
}

/** 写入配置（原子写 + .bak） */
export async function writeConfig(patch: Partial<AppConfig>): Promise<ConfigSnapshot> {
  const s = getConfigStore();
  await s.update((cur) => appConfigSchema.parse({ ...cur, ...patch }));
  return readConfigSnapshot();
}
