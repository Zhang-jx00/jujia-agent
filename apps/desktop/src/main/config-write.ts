/**
 * 配置写入的白名单判定（轨道回归计划 2 · R-03）。
 *
 * 为什么抽出来：这段逻辑原本内联在 `ipc.ts` 的 IPC 处理里 —— 那样只有界面级 e2e 能覆盖，
 * **变异测试咬不到**（变异脚本跑的是 vitest 用例）。抽成纯函数后，
 * "白名单外必须被拒绝"这条约束就有了真正的单测。
 *
 * 背景（轨道回归计划 1 修 S1）：此前是"照单收下、只挑几个写进去"，
 * 于是权限面板切模式会**成功返回但什么都没改**、界面还提示"已切换" ——
 * 静默丢弃是这一类缺陷的共同根因，现在改成显式拒绝。
 */

import type { AppConfig } from '@jujia/shared-ipc';

/**
 * 允许**渲染层**写入的配置键。
 *
 * - `theme` / `appearance`：纯外观，用户随手就改；
 * - `permissionMode`：**用户自己的选择**，界面必须提供这个开关。
 *   至于"渲染层被注入后能自己切模式"——那种情况下它同样能自动点掉审批弹窗，
 *   所以在 IPC 层禁止写入**不带来真实安全收益**，却会让功能不可用（取舍见 SECURITY.md）。
 *
 * **`workspace` 不在此列**：它决定工具能碰哪些路径，属于权限边界，
 * 只能由用户在主进程的目录选择器里指定。`alwaysAskTools` 同理。
 */
export const WRITABLE_CONFIG_KEYS: ReadonlyArray<keyof AppConfig> = [
  'theme',
  'appearance',
  'permissionMode',
];

/**
 * **`browserOpenWith` 刻意不在此列**（M10 收尾）：它记的是"上次用户真的用哪一档打开了"，
 * 由主进程在打开成功之后写入（见 `ipc/browser.ts`）。
 * 虽然它只是下拉框的预选位置、不是授权（外发两档每次都过硬 ask），
 * 但"界面能写安全相关字段"这个口子少开一个是一个 —— 而且省掉一次读-改-写的竞态。
 *
 * 与之同类的还有**自选程序的路径**：那条更直接，它决定启动哪个进程，
 * 只能由主进程的原生文件对话框选定（见 `open-with-service.ts`）。
 */

export interface ConfigWriteDecision {
  /** 真正允许落盘的字段 */
  clean: Partial<AppConfig>;
  /** 被拒绝的字段（**会被上层转成显式报错**，绝不静默丢弃） */
  rejected: string[];
}

/**
 * 一次配置写入请求。
 *
 * **注意可选键显式写成 `| undefined`**：zod 的 `parse` 结果在本项目的
 * `exactOptionalPropertyTypes: true` 下会带上显式 undefined，
 * 不写这一层会导致调用点报 TS2379（这是项目里记过的坑，别再改回去）。
 */
export type ConfigPatch = { [K in keyof AppConfig]?: AppConfig[K] | undefined };

/**
 * 按白名单拆分一次配置写入请求。
 *
 * @param patch 已经过 schema 校验的部分配置
 * @param writable 白名单（默认 {@link WRITABLE_CONFIG_KEYS}；测试可注入）
 */
export function pickWritableConfig(
  patch: ConfigPatch,
  writable: ReadonlyArray<keyof AppConfig> = WRITABLE_CONFIG_KEYS,
): ConfigWriteDecision {
  const rejected: string[] = [];

  // 第一趟：先把"不该写的"挑出来（**报全部，不是只报第一个** —— 一次把问题说清）
  for (const key of Object.keys(patch) as (keyof AppConfig)[]) {
    if (patch[key] === undefined) continue; // 显式 undefined 不算一次写入
    if (!writable.includes(key)) rejected.push(String(key));
  }

  /**
   * 第二趟：逐键窄化地拷贝允许的字段。
   *
   * 刻意**不用泛型赋值 + 断言**：本项目开了 `exactOptionalPropertyTypes`，
   * 泛型写法会让 `'light' | 'dark' | undefined` 赋给 `'light' | 'dark'`（实测报 TS2379/TS2412）。
   * 只有三个键，显式写开既安全又不用 `as`。
   */
  const clean: Partial<AppConfig> = {};
  if (writable.includes('theme') && patch.theme !== undefined) clean.theme = patch.theme;
  if (writable.includes('appearance') && patch.appearance !== undefined) {
    clean.appearance = patch.appearance;
  }
  if (writable.includes('permissionMode') && patch.permissionMode !== undefined) {
    clean.permissionMode = patch.permissionMode;
  }

  return { clean, rejected };
}
