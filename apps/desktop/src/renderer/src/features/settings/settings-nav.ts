/**
 * 设置中心的**导航清单**（R67 · 设置中心）。
 *
 * 为什么单独成文件（不写在组件里）：这份清单要同时被**界面**与**判据**用
 * —— 判据直接 `import` 它，才不会出现"界面上有一项、判据里抄的是另一份"（两份清单 = 两份真相）。
 */

/** 设置中心能到达的全部设置项 */
export type SettingsItem = 'appearance' | 'permissions' | 'hooks' | 'plugins' | 'mcp';

/** 设置项的显示名 */
export const SETTINGS_LABEL: Record<SettingsItem, string> = {
  appearance: '外观',
  permissions: '权限规则',
  hooks: '钩子',
  plugins: '插件',
  mcp: 'MCP',
};

/** 左导航里的一个分组（一组标题 + 一组设置项） */
export interface SettingsGroup {
  readonly title: string;
  readonly items: readonly SettingsItem[];
}

/**
 * 左导航分组。
 *
 * 分组口径与左栏**不同**：左栏按"用得多不多"排；设置按"**是什么东西**"排
 * （偏好 / 规则与安全 / 扩展）—— 用户来设置中心时脑子里的分类就是这个。
 */
export const SETTINGS_NAV: readonly SettingsGroup[] = [
  { title: '偏好', items: ['appearance'] },
  { title: '规则与安全', items: ['permissions', 'hooks'] },
  { title: '扩展', items: ['plugins', 'mcp'] },
];
