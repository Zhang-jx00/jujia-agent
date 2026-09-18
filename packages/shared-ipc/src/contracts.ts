import { z } from 'zod';

/** 应用与运行时信息（P0 打通链路用；后续阶段会逐步扩充字段）。 */
export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  /** 当前生效的安全开关，便于渲染层展示与自检 */
  security: z.object({
    contextIsolation: z.boolean(),
    sandbox: z.boolean(),
    nodeIntegration: z.boolean(),
    webSecurity: z.boolean(),
  }),
  /** 数据根目录绝对路径（JuJiaData） */
  dataRoot: z.string(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** 应用配置（Phase 1 先落两个字段，设置页在 W6 扩） */
export const appConfigSchema = z.object({
  theme: z.enum(['light', 'dark']),
  workspace: z.string().nullable(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const defaultAppConfig = (): AppConfig => ({ theme: 'dark', workspace: null });

/** 配置读取结果：带上「来源」与「是否从损坏中恢复」，供 UI 如实提示用户 */
export const configSnapshotSchema = z.object({
  config: appConfigSchema,
  version: z.number().int().nonnegative(),
  source: z.enum(['primary', 'backup', 'default']),
  recovered: z.boolean(),
  /**
   * 本次会话中发生过的恢复来源（没有则为 null）。
   *
   * 为什么需要它：自愈写入完成后，磁盘上已经是健康的 primary，
   * 单看 `source` 无法再看出「本次启动曾经损坏过」，用户会被静默糊弄过去。
   */
  recoveredFrom: z.enum(['backup', 'default']).nullable().default(null),
  recoveredAt: z.string().nullable().default(null),
});

export type ConfigSnapshot = z.infer<typeof configSnapshotSchema>;
