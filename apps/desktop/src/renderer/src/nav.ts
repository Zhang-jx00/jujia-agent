/**
 * 导航的**单一真源**（R66 · 主界面两栏化）。
 *
 * 为什么单独成文件：页签的「清单 / 标签 / 归属分组」是**同一件事的三个侧面** ——
 * 拆成两份（`App.tsx` 里一份、判据里再抄一份）就会出现"加了页签忘了分组"，
 * 而那种漏**在界面上看不出来**（只是少一个入口），只有机器判据能抓住。
 * ⇒ 判据直接 `import` 这份，不许另抄。
 */

/**
 * 左侧导航能到达的全部界面（主界面两栏化后，页签从顶栏搬到了左栏）。
 *
 * **设置类界面不在这里**（R67 · 设置中心）：外观 / 权限规则 / 钩子 / 插件 / MCP
 * 都收进**整页覆盖的设置中心**（左导航分组 + 右侧内容）⇒ 左栏只留"干活要用的"入口，
 * 设置类从左栏底部的齿轮进 ⇒ **同一个目的地只有一处门**（参考桌面工具的通行做法）。
 */
export type Tab =
  | 'overview'
  | 'chat'
  | 'ide'
  | 'docs'
  | 'git'
  | 'canvas'
  | 'terminal'
  | 'connections'
  | 'browser'
  | 'media'
  | 'schedule';

/** 页签显示名（唯一出处；界面与判据都从这里取） */
export const TAB_LABEL: Record<Tab, string> = {
  overview: '概览',
  chat: '对话',
  ide: '文件',
  docs: '文档',
  git: 'Git',
  canvas: '画布',
  terminal: '终端',
  connections: '连接',
  browser: '浏览器',
  media: '绘图',
  schedule: '定时',
};

/** 左栏里的一个分组（一组标题 + 一组入口） */
export interface NavGroup {
  /** 分组标题（左栏里的小标题） */
  readonly title: string;
  /** 该组包含的入口 */
  readonly tabs: readonly Tab[];
}

/**
 * 左栏分组。
 *
 * 分组的原则是**按"每天用它的频率"排**，不是按功能分类学：
 * 前两组是"干活要用的"，第三组是"偶尔调一次的"。
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  { title: '工作区', tabs: ['overview', 'chat', 'ide', 'docs', 'git', 'canvas', 'terminal'] },
  { title: '连接与工具', tabs: ['connections', 'browser', 'media', 'schedule'] },
];
