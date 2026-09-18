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

/**
 * 本次会话内发生过的启动期恢复事件。
 *
 * 复核发现（2026-09-18 第二遍）：自愈写入后磁盘上已是健康 primary，
 * 仅凭 `source` 无法再表达「本次启动曾损坏并恢复」，UI 也就永远看不到恢复提示。
 * 故单独记录，随快照上报。
 */
let startupRecovery: { from: 'backup' | 'default'; at: string } | null = null;

/** 仅用于测试：重置会话级恢复标记 */
export function __resetStartupRecovery(): void {
  startupRecovery = null;
}

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
  // recovered 为真时来源必然是 backup/default；此处显式收窄，供类型与契约共用
  const liveFallback: 'backup' | 'default' | null = res.source === 'primary' ? null : res.source;
  const snapshot: ConfigSnapshot = {
    config: res.data,
    version: res.detectedVersion ?? CONFIG_VERSION,
    source: res.source,
    recovered: res.recovered || startupRecovery !== null,
    recoveredFrom: startupRecovery?.from ?? (res.recovered ? liveFallback : null),
    recoveredAt: startupRecovery?.at ?? null,
  };
  return configSnapshotSchema.parse(snapshot);
}

/**
 * 首次启动落盘默认配置；若检测到配置不可用则自愈写回（原子写 + 保留健康 .bak）。
 *
 * 复核发现（2026-09-18 第二遍）：初版只在 IPC 被显式调用时才写盘，
 * 导致运行时的「写 → 备份 → 损坏恢复」链路从未被真实走到（冒烟只覆盖了读路径）。
 * 补上首次落盘后，`npm run smoke` 即可覆盖写路径，并可在复核中做损坏恢复实验。
 */
export async function ensureConfigFile(): Promise<ConfigSnapshot> {
  const s = getConfigStore();
  const before = await s.read();

  if (before.source !== 'primary') {
    startupRecovery = {
      from: before.source === 'backup' ? 'backup' : 'default',
      at: new Date().toISOString(),
    };
    console.warn(
      `[config] 启动时配置不可用（来源=${before.source}），已用${before.source === 'backup' ? '备份' : '默认值'}自愈写回`,
    );
    await s.write(before.data);
  }

  return readConfigSnapshot();
}

/** 写入配置（原子写 + .bak） */
export async function writeConfig(patch: Partial<AppConfig>): Promise<ConfigSnapshot> {
  const s = getConfigStore();
  await s.update((cur) => appConfigSchema.parse({ ...cur, ...patch }));
  return readConfigSnapshot();
}
