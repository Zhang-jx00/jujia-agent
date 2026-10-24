import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS, filterCommands } from './commands';
import { LAUNCHER_ONLY_TABS, NAV_GROUPS, TAB_LABEL } from '../../nav';
import type { Tab } from '../../nav';

/**
 * 外壳源码（R68 · 启动器的鼠标入口那条锁要读它）。
 *
 * ⚠️ **匹配前先剥注释**（R54 的教训 ⑫）：注释里写着什么不重要，
 * 重要的是**那段代码真的把启动器叫起来了** ⇒ 注释里提一句"鼠标入口"不该让锁变绿。
 */
const appSrc = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');
const appSrcNoComments = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 样式表（R68 · 鼠标入口的形状锁）。
 *
 * 同样**先剥注释**再判（R54 的教训 ⑫）：注释里写着"min-height"不该让锁变绿。
 */
const styles = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8');
const stylesNoComments = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 启动器的**接线锁**（R68 · 左栏瘦身）。
 *
 * 为什么立它：左栏瘦到 7 项之后，「连接 / 浏览器 / 绘图 / 定时」**离开了侧栏** ——
 * 而本仓 T83 那条教训是「入口藏起来 ⇒ 用户不知道还有 ⇒ 更糟」。
 * ⇒ 所以这四项**必须**在启动器里**一处搜得到** ⇒ 这条锁盯的就是这件事：
 * **移出侧栏的那些项，忘了放进启动器 ⇒ 界面上就真的少了一页**。
 *
 * 顺带盯住两件容易悄悄坏掉的：① 命令清单**由导航真源生成**（不许另抄一份 ⇒ 侧栏改了它自动跟着改）；
 * ② 筛选**是真的**（搜得到 / 搜不到）。
 */
describe('启动器：一处搜全部', () => {
  it('命令清单必须覆盖**每一个**入口（侧栏的 + 移出侧栏的 + 设置）', () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    const missing = (Object.keys(TAB_LABEL) as Tab[]).filter((t) => !ids.has(t));
    expect(missing, '这些入口在启动器里搜不到 ⇒ 等于消失了').toEqual([]);
  });

  it('移出侧栏的那几项**仍然在启动器里**（移出不等于藏起来 · T83 的教训）', () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    expect(LAUNCHER_ONLY_TABS.filter((t) => !ids.has(t))).toEqual([]);
  });

  it('设置是一个入口（同类桌面工具都把设置放进导航体系里，而不是"听说左下角有个齿轮"）', () => {
    expect(COMMANDS.filter((c) => c.target === 'settings').map((c) => c.id)).toEqual(['settings']);
  });

  it('命令的 id 唯一、label 不空、target 合法', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size, '命令 id 重复了').toBe(ids.length);
    expect(COMMANDS.filter((c) => c.label.trim() === '')).toEqual([]);
    const legal = new Set<string>([...(Object.keys(TAB_LABEL) as Tab[]), 'settings']);
    expect(COMMANDS.filter((c) => !legal.has(c.target)).map((c) => c.id)).toEqual([]);
  });

  it('命令清单**由导航真源生成**（改了左栏它自动跟着改 ⇒ 不存在两份清单）', () => {
    const fromNav = [...NAV_GROUPS.flatMap((g) => g.tabs), ...LAUNCHER_ONLY_TABS].sort();
    const fromList = COMMANDS.filter((c) => c.target !== 'settings')
      .map((c) => c.id)
      .sort();
    expect(fromList).toEqual(fromNav);
  });

  it('筛选是真的：搜得到、搜不到都别装懂', () => {
    expect(filterCommands(COMMANDS, '').length).toBe(COMMANDS.length);
    expect(filterCommands(COMMANDS, '定时').map((c) => c.id)).toEqual(['schedule']);
    expect(filterCommands(COMMANDS, '这个肯定搜不到的东西')).toEqual([]);
  });

  /**
   * **清单右侧那一列不许是显示名的复读**（R68）。
   *
   * 第一版右侧提示直接取**别名的第一个词** ⇒ 而每个别名的第一个词**恰好等于显示名**
   * （`概览 首页 …` / `对话 聊天 …` / `文件 树 …`）⇒ 12 行全是"概览 … 概览"这种重复字样
   * ⇒ **看起来像 bug**（而且是那种"代码完全正常、界面就是别扭"的 bug）。
   * ⇒ 改成"第一个**不等于**显示名的词"，那一列才是一条**有用的**信息：**还能这么搜**。
   */
  it('每一条的提示都不等于自己的显示名（否则那一列是复读）', () => {
    const same = COMMANDS.filter((c) => c.hint.trim() === c.label.trim()).map((c) => c.id);
    expect(same, '这些条目的右侧提示和显示名一模一样 ⇒ 那一列是复读').toEqual([]);
    const empty = COMMANDS.filter((c) => c.hint.trim() === '').map((c) => c.id);
    expect(empty, '这些条目没有提示词 ⇒ 那一格该不渲染（别留空占位）').toEqual([]);
  });

  it('提示词确实能当别名搜到（那一列不是在骗人）', () => {
    for (const cmd of COMMANDS) {
      expect(
        filterCommands(COMMANDS, cmd.hint).map((c) => c.id),
        `提示「${cmd.hint}」搜不出「${cmd.label}」⇒ 那一列写的是不能用的词`,
      ).toContain(cmd.id);
    }
  });

  /**
   * 「分组要真分」这条判据，R68 从左栏**搬到了这里**（左栏瘦身 ⇒ 左栏只剩一组，
   * 真正在分的那份清单变成了启动器的分组）⇒ 覆盖没有丢。
   */
  it('启动器的分组 ≥2 且每组 ≥1 项（只有一个组 = 没分组，只是换了个画法）', () => {
    const groups = new Map<string, number>();
    for (const cmd of COMMANDS) groups.set(cmd.group, (groups.get(cmd.group) ?? 0) + 1);
    expect(groups.size, '启动器的分组少于两个 ⇒ 那就没分组').toBeGreaterThanOrEqual(2);
    expect([...groups.entries()].filter(([, n]) => n === 0)).toEqual([]);
    expect([...groups.keys()].filter((t) => t.trim() === '')).toEqual([]);
  });
});

/**
 * **启动器必须有鼠标入口**（R68 · 左栏瘦身的完整形态）。
 *
 * 为什么立它：低频入口（连接 / 浏览器 / 绘图 / 定时）离开左栏之后**只剩启动器一条路**
 * ⇒ 启动器若**只有 Ctrl/Cmd+Shift+P**，对不用键盘的人就是**藏起来**
 * ⇒ 正是本仓 T83 那条教训（「入口藏起来 ⇒ 用户不知道还有 ⇒ 更糟」）。
 * ⇒ 所以左栏顶上必须有一个**看得见、点得到**的按钮。
 *
 * 为什么读源码而不是问 DOM：这条锁盯的是"**按钮真的接上了线**"——
 * 一个渲染出来但点了没反应的按钮，在源码层最容易看出来（没有那个调用）。
 */
describe('启动器：必须有鼠标入口（不然快捷键 = 藏起来）', () => {
  it('左栏里那个搜索按钮必须真的把启动器叫起来', () => {
    const anchor = 'className="jj-rail-search';
    const occurrences = appSrcNoComments.split(anchor).length - 1;
    expect(occurrences, '左栏里那个「搜索功能」按钮不见了（或不止一个）⇒ 锚点不唯一').toBe(1);
    const at = appSrcNoComments.indexOf(anchor);
    const close = appSrcNoComments.indexOf('</button>', at);
    expect(close, '找不到那个按钮的收尾标签 ⇒ 源码被改坏了').toBeGreaterThan(at);
    const region = appSrcNoComments.slice(at, close);
    expect(
      region,
      '左栏的「搜索功能」按钮没有打开启动器 ⇒ 它是个摆设（点了没反应）',
    ).toMatch(/setPaletteOpen\(true\)/);
  });

  it('那个按钮必须**显示给人看**（不许只剩一个图标）', () => {
    const at = appSrcNoComments.indexOf('className="jj-rail-search');
    const close = appSrcNoComments.indexOf('</button>', at);
    const region = appSrcNoComments.slice(at, close);
    expect(region, '按钮里没有可见文字 ⇒ 只剩一个图标 = 又是一个"藏起来"的入口').toMatch(
      /搜索功能/,
    );
  });

  /**
   * **命中区的形状锁**（R68）。
   *
   * 为什么单独一条：这个按钮是**左栏里唯一的"第二入口"** ⇒ 它要是又矮又小，
   * 用户根本不会注意到（这正是"藏起来"的另一种样子）。
   *
   * 为什么盯**声明层**而不盯渲染结果：`min-height` 与 `line-height` 都是**声明**，
   * jsdom 没有布局引擎 ⇒ 量不到 ⇒ 只能钉声明；e2e 那一步（真窗口）量它的实际盒子。
   */
  it('`.jj-rail-search` 必须显式给高度下限与行高（按钮族标准 32px）', () => {
    const block = /^\.jj-rail-search \{[^}]*\}/m.exec(stylesNoComments)?.[0] ?? '';
    expect(block, '样式表里找不到 `.jj-rail-search` 规则').not.toBe('');
    expect(
      block,
      '`.jj-rail-search` 没有 `min-height: 32px` ⇒ 它的命中区可能低于按钮族标准（左栏里唯一的第二入口不能又矮又小）',
    ).toMatch(/min-height:\s*32px/);
  });

  /**
   * **按钮族的高度不许因标签语言而变**（R68 · 家族锁）。
   *
   * 根因（本仓 R66 当场量出来的）：**Chromium 的表单控件不继承 `body` 的 `line-height`**
   * （UA 样式表给 `button` 写死 `line-height: normal`）⇒ 行盒高度按**字体度量**算
   * ⇒ 纯拉丁标签比中文标签**矮 4px**（实测 13px 下：拉丁 15.33px / 中文 19.33px）
   * ⇒ 同一族按钮里"英文标签的那几个"天生比中文的矮。
   *
   * 为什么是**一族一把尺子**：混进来别的形状就会恒红（恒绿的锁比没锁更坏）。
   * 这三处是本轮/R67 落在**左栏与启动器**上的按钮族（`Git` 是拉丁标签 ⇒ 正是受害的那个）。
   */
  it('这一族按钮都显式给了 `line-height`（否则拉丁标签比中文标签矮 4px）', () => {
    for (const sel of ['.jj-launcher-item', '.jj-rail-search', '.jj-rail-settings']) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 同样**锚到行首**：不锚的话 `.jj-launcher-item` 会撞上 `.jj-launcher-item-label` 那块
      const block = new RegExp(`^${esc}\\s*\\{[^}]*\\}`, 'm').exec(stylesNoComments)?.[0] ?? '';
      expect(block, `样式表里找不到 \`${sel}\` 的规则`).not.toBe('');
      expect(
        block,
        `${sel} 没有显式 \`line-height\` ⇒ Chromium 给表单控件写死 \`line-height: normal\` ⇒ ` +
          '行盒高度随字体度量变（拉丁标签比中文标签矮 4px —— 本仓 .app-tab 那条坑的同款）',
      ).toMatch(/line-height:\s*[\d.]+/);
    }
  });
});
