import { LAUNCHER_ONLY_TABS, NAV_GROUPS, TAB_ICON, TAB_LABEL } from '../../nav';
import type { Tab } from '../../nav';

/**
 * **启动器**的命令清单（R68 · 左栏瘦身）。
 *
 * 为什么要有它：左栏瘦到 7 项之后，「连接 / 浏览器 / 绘图 / 定时」就不在侧栏了 ——
 * 但**移出不等于藏起来**（本仓 T83 的教训：入口藏起来 ⇒ 用户不知道还有 ⇒ 更糟）。
 * ⇒ 这里是**第二入口**：一处搜全部（侧栏的 + 低频的 + 设置）。
 *
 * 这份清单**由导航真源生成**（`nav.ts`）⇒ 侧栏改了，这里自动跟着改
 * ⇒ **不存在"两份清单"**（R63 那次教训：自己写第二份 ⇒ 两份数 ⇒ 假账）。
 */
export type CommandTarget = Tab | 'settings';

export interface AppCommand {
  /** 机器键（判据用它对账） */
  readonly id: string;
  /** 显示名 */
  readonly label: string;
  /** 分组（面板里按组显示） */
  readonly group: string;
  /** 搜索用：除显示名之外的别名（空格分隔） */
  readonly keywords: string;
  /** 清单里右侧那一列：一个**与显示名不同**的近义词（提示"还能这么搜"） */
  readonly hint: string;
  /** 图标名（R69 · 左栏图标化：启动器与左栏用**同一枚**图标 ⇒ 同一个入口在两处长得一样） */
  readonly icon: string;
  /** 落到哪个目的地 */
  readonly target: CommandTarget;
}

/** 每个入口的搜索别名（用户会搜的词，不一定是界面上的名字） */
const KEYWORDS: Record<Tab, string> = {
  overview: '概览 首页 主页 overview home',
  chat: '对话 聊天 会话 chat conversation',
  ide: '文件 树 编辑器 目录 file tree ide',
  docs: '文档 阅读 markdown doc',
  git: 'git 提交 commit 仓库 分支',
  canvas: '画布 流程 编排 节点 canvas workflow',
  terminal: '终端 命令 shell terminal',
  connections: '连接 模型 服务 api key connection',
  browser: '浏览器 网页 web browser',
  media: '绘图 图片 生成 图像 media image',
  schedule: '定时 计划 任务 cron schedule',
};

/**
 * 挑一个**与显示名不同**的近义词当右侧提示。
 *
 * 为什么不能直接取别名的第一个词：**每个别名的第一个词都恰好等于显示名**
 * （`概览 首页 …` / `对话 聊天 …` / `文件 树 …`）⇒ 那一列会 12 行全是重复字样
 * （"概览 … 概览"）⇒ **看起来像 bug**。
 * ⇒ 改成"第一个**不等于**显示名的词"，那才是一条有用的信息：**还能这么搜**。
 *
 * 挑不出来就留空 ⇒ 那一格不渲染（不留空占位）。
 */
function pickHint(label: string, keywords: string): string {
  return (
    keywords
      .split(' ')
      .map((k) => k.trim())
      .find((k) => k !== '' && k.toLowerCase() !== label.toLowerCase()) ?? ''
  );
}

function toCommand(tab: Tab, group: string): AppCommand {
  const label = TAB_LABEL[tab];
  return {
    id: tab,
    label,
    group,
    keywords: KEYWORDS[tab],
    hint: pickHint(label, KEYWORDS[tab]),
    icon: TAB_ICON[tab],
    target: tab,
  };
}

/** 设置这一项（它不是页签，是**整页覆盖的设置中心**） */
export const SETTINGS_COMMAND: AppCommand = {
  id: 'settings',
  label: '设置',
  group: '设置',
  keywords: '设置 配置 外观 权限 钩子 插件 mcp settings preferences',
  hint: '配置',
  icon: 'gear',
  target: 'settings',
};

/** 全部命令（侧栏项 + 仅启动器可达项 + 设置） */
export const COMMANDS: readonly AppCommand[] = [
  ...NAV_GROUPS.flatMap((group) => group.tabs.map((tab) => toCommand(tab, group.title))),
  ...LAUNCHER_ONLY_TABS.map((tab) => toCommand(tab, '工具')),
  SETTINGS_COMMAND,
];

/**
 * 按查询过滤命令。
 *
 * 口径：**所有词都要命中**（空格分词 ⇒ 多词是"与"关系）。
 * 命中范围 = 显示名 + 别名 + 分组名。
 */
export function filterCommands(commands: readonly AppCommand[], query: string): AppCommand[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...commands];
  return commands.filter((cmd) => {
    const haystack = `${cmd.label} ${cmd.keywords} ${cmd.group}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}
