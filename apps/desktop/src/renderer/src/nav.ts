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

/**
 * 页签显示名（唯一出处；界面与判据都从这里取）
 */
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

/**
 * 每个入口的**图标名**（R69 · 左栏图标化）。
 *
 * 为什么这里只放**名字**、不放组件：`nav.ts` 是**纯数据模块**（主进程那条接线锁把它当**文本**读）
 * ⇒ 让它 import React 组件会把纯数据变成 UI 模块。
 * ⇒ 「图标名 → 组件」那张表在 `ui/icons.tsx`（`ICON_BY_NAME`）⇒ **两张表各管一段，没有重复**。
 *
 * 为什么每个入口都要有：R68 之后左栏只剩 7 个**纯文字**入口 ⇒ 一眼扫过去认不出哪一页是哪一页
 * （"文件"和"文档"、"Git"和"画布"都只是两个字）⇒ 图标是**第二个识别通道**。
 *
 * ⚠️ **不许只留图标**：图标旁边永远有文字（图标是装饰，`aria-hidden`）⇒ 文字是**主要**识别通道。
 */
export const TAB_ICON: Record<Tab, string> = {
  overview: 'layout-dashboard',
  chat: 'message-square',
  ide: 'folder',
  docs: 'file-text',
  git: 'git-branch',
  canvas: 'workflow',
  terminal: 'terminal',
  connections: 'plug',
  browser: 'globe',
  media: 'image',
  schedule: 'clock',
};

/** 左栏里的一个分组（一组标题 + 一组入口） */
export interface NavGroup {
  /** 分组标题（左栏里的小标题） */
  readonly title: string;
  /** 该组包含的入口 */
  readonly tabs: readonly Tab[];
}

/**
 * 左栏分组（R68 · 左栏瘦身）。
 *
 * 只留**工作区类**入口 —— 所有者那句「**不要把所有东西都丢在左边的侧边栏**」。
 * 低频的那几项（连接 / 浏览器 / 绘图 / 定时）去了 `LAUNCHER_ONLY_TABS`
 * （**仍在启动器里一处搜得到**，不是"藏起来"）。
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  { title: '工作区', tabs: ['overview', 'chat', 'ide', 'docs', 'git', 'canvas', 'terminal'] },
];

/**
 * **不在左栏、但仍能到达**的入口（R68 · 左栏瘦身）。
 *
 * 为什么它们离开左栏：所有者那句「不要把所有东西都丢在左边的侧边栏」。
 * 为什么它们不会"消失"：**启动器**（Ctrl/Cmd+Shift+P）里能搜到
 * （命令清单由 `features/launcher/commands.ts` 生成 ⇒ 侧栏 + 这里 + 设置
 * = **并集完整、不交叠**，由判据盯着）。
 *
 * ⚠️ 这不是"藏起来"：本仓 T83 那条教训是「横向滚动把入口藏在右边 ⇒ 用户不知道还有 ⇒ 更糟」——
 * 移出侧栏**必须**配一条**一处搜得到**的路（启动器），否则就是重犯那条错。
 */
export const LAUNCHER_ONLY_TABS: readonly Tab[] = ['connections', 'browser', 'media', 'schedule'];
