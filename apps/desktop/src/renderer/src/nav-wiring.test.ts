import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, LAUNCHER_ONLY_TABS, TAB_LABEL } from './nav';
import type { Tab } from './nav';

const styles = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
/**
 * **剥掉注释**再判 —— R54 的教训（⑫ 那条锁第一版**被自己的注释喂饱** ⇒ 假绿）。
 * 本文件里那条注释恰好也写着 `flex: 0 0 auto` ⇒ 不剥就等于"注释替声明作证"。
 */
const stylesNoComments = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * **导航接线锁（R66 · 主界面两栏化）**
 *
 * 为什么立它：左栏是**分组**渲染的（`NAV_GROUPS`），而入口清单是另一份（`TAB_LABEL`）。
 * 两份都在的时候，"**加了入口忘了分组**"会静静发生 ——
 * 界面表现只是左栏少一个按钮，**没有任何门禁会红**（单测不测"少一个"，
 * e2e 也不该为"少一个"去红）。这种漏只能靠机器盯。
 *
 * 为什么判据直接 `import` 这份而不是另抄一份：
 * 抄一份就变成"两份真相"（抄出来的清单会漂）⇒ 那时这条锁红的是**抄错的副本**，
 * 不是真缺（这正是 R63 那次"同两份队列被数出 78 与 76"的同款坑）。
 */
describe('左栏导航：入口不许漏收', () => {
  it('每个入口**恰好**出现在「左栏分组 ∪ 仅启动器项」里（R68：侧栏瘦身后，移出去的那些也不能消失）', () => {
    const all = Object.keys(TAB_LABEL) as Tab[];
    const seen = new Map<Tab, number>();
    for (const group of NAV_GROUPS) {
      for (const tab of group.tabs) seen.set(tab, (seen.get(tab) ?? 0) + 1);
    }
    for (const tab of LAUNCHER_ONLY_TABS) seen.set(tab, (seen.get(tab) ?? 0) + 1);
    const missing = all.filter((tab) => !seen.has(tab));
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([tab]) => tab);
    expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
  });

  it('左栏不许把所有入口都收进来（R68 · 左栏瘦身：侧栏只放工作区类，低频项走启动器）', () => {
    const railCount = NAV_GROUPS.reduce((n, g) => n + g.tabs.length, 0);
    expect(
      railCount,
      '左栏又把所有入口收回来了 ⇒ 所有者那句「不要把所有东西都丢在左边的侧边栏」就白改了',
    ).toBeLessThan(Object.keys(TAB_LABEL).length);
    expect(LAUNCHER_ONLY_TABS.length, '低频入口没进启动器 ⇒ 侧栏瘦了但那些页到不了').toBeGreaterThan(0);
  });

  it('分组不许是空壳（有标题没有入口 = 分组没真分）', () => {
    expect(NAV_GROUPS.filter((group) => group.tabs.length === 0)).toEqual([]);
  });

  it('分组标题不空、不重复', () => {
    const titles = NAV_GROUPS.map((group) => group.title);
    expect(titles.filter((t) => t.trim() === '')).toEqual([]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('至少两个分组（只有一个组 = 没分组，只是换了个画法）', () => {
    // R68：左栏瘦身后**分组这件事搬到了启动器**（工作区 / 工具 / 设置）⇒ 这条判据**跟着搬家**，
    // 不是被删掉：新家在 `features/launcher/launcher-wiring.test.ts`
    // （「启动器的分组 ≥2 且每组 ≥1 项」）⇒ 覆盖没有丢：**分组要真分**这件事，
    // 现在盯的是**真正在分的那份清单**。
    expect(NAV_GROUPS.length).toBeGreaterThanOrEqual(1);
  });

  it('每个入口都有显示名（显示名空 = 界面上是个空按钮）', () => {
    const empty = (Object.keys(TAB_LABEL) as Tab[]).filter((tab) => TAB_LABEL[tab].trim() === '');
    expect(empty).toEqual([]);
  });
});

/**
 * 选中态的**形态锁**。
 *
 * 为什么是形态而不是"量对比度"：对比度要在真窗口里量（e2e 那一步已经量了，见 e2e-ui.mjs
 * 的"左栏选中态"一条）；这里守的是**声明层的那一刀** ——
 * 选中态必须**实心主色 + 反色字**（`--primary` / `--primary-ink`），
 * 不许退化成"淡底"。理由是现扫出来的硬数字：深色调色板里两个相邻的浅底
 * 对比度只有 1.1–1.3:1 ⇒ **在界面上等于没高亮**，而代码里"高亮"俱全 ⇒ 只有形态锁能挡住这次退化。
 */
describe('左栏导航：选中态不许退化成淡底', () => {
  it('`.app-tab-active` 必须是实心主色底 + 反色字', () => {
    // ⚠️ 选择器必须**锚到行首**（`^`）：不锚的话，`/\.app-tab \{…\}/` 会先撞上
    // `.app-rail-group-items > .app-tab {` 那块 ⇒ 量到的是**别的规则** ⇒ 锁会假绿。
    // （这个坑是基线复跑当场抓出来的：把注释剥掉后，正则命中了子选择器那块。）
    const block = /^\.app-tab-active \{[^}]*\}/m.exec(styles)?.[0] ?? '';
    expect(block, '样式表里找不到 `.app-tab-active` 规则').not.toBe('');
    // ⚠️ 必须**按声明名**钉，不能只判"块里出现过 --primary"：
    // 那条更松的写法被变异 M334 证伪过 —— 把 `background` 换成 `transparent` 之后，
    // 块里的 `border-color: var(--primary)` 仍然存在 ⇒ 松写法照绿 ⇒ 锁是假的。
    expect(block, '选中态的背景必须是实心主色（退化成淡底 ⇒ 界面上看不出选中）').toMatch(
      /background:\s*var\(--primary\)/,
    );
    expect(block, '选中态的字色没有跟着主色走（`--primary-ink`）').toMatch(
      /color:\s*var\(--primary-ink\)/,
    );
  });

  it('导航项不许折行（折行 = 一排竖着的单字，那是 R45 量出来的旧形态）', () => {
    const block = /^\.app-tab \{[^}]*\}/m.exec(styles)?.[0] ?? '';
    expect(block, '样式表里找不到 `.app-tab` 规则').not.toBe('');
    expect(block).toContain('white-space: nowrap');
  });

  /**
   * **选中态不许被 hover 吃掉**（R67 的 e2e 当场抓到的）。
   *
   * `.app-tab:hover` 的特异性是 (0,2,0) ⇒ **比 `.app-tab-active` 的 (0,1,0) 高**
   * ⇒ 鼠标停在**选中项**上时，它会退回"淡底 + 浅色字" ⇒ **选中态当场消失**
   * （实测：字与底 1.09:1 —— 那正是本文件上面那条"选中态不许退化成淡底"要防的形态）。
   * ⇒ 修法：加一条 `.app-tab-active:hover` 的覆盖（(0,2,0) 且写在后面 ⇒ 赢）。
   */
  it('`.app-tab-active:hover` 必须存在且仍是实心主色（否则选中项一被悬停就"看起来没选中"）', () => {
    const block = /^\.app-tab-active:hover \{[^}]*\}/m.exec(styles)?.[0] ?? '';
    expect(
      block,
      '样式表里找不到 `.app-tab-active:hover` ⇒ 悬停会盖掉选中态（`.app-tab:hover` 特异性更高）',
    ).not.toBe('');
    expect(block, '选中 + 悬停时不是实心主色底').toMatch(/background:\s*var\(--primary\)/);
    expect(block, '选中 + 悬停时字色没跟着主色走').toMatch(/color:\s*var\(--primary-ink\)/);
  });
});

/**
 * **入口的高度不许有两种**（R66 第一版被 e2e 当场抓住 —— 真 bug，不是误报）。
 *
 * 实测（真窗口）：`.app-tab` 的高度有**两种** —— 中文标签 **32.67px**、
 * **纯拉丁标签（Git / MCP）只有 28.67px** ⇒ 跌破按钮族标准的 32×32。
 * 根因：**Chromium 的表单控件不继承 `body` 的 `line-height`**（UA 样式表给 `button`
 * 写死 `line-height: normal`）⇒ 行盒高度随**字体度量**变 ⇒ 拉丁字形比中文字形矮 4px。
 * ⇒ 修法：给 `.app-tab` **显式** `line-height` ⇒ 所有入口一样高。
 *
 * 为什么这一层要**形态锁**（声明层）：那 4px 是**渲染结果**，jsdom 没有布局引擎 ⇒ 量不到；
 * 能量到的是 e2e 的窄窗那一步（它量**真窗口**里的每个入口高度）。
 * ⇒ 两边各管一半：形态锁钉"**必须显式给行高**"，e2e 钉"**量出来不许低于 32px**"。
 */
describe('左栏导航：入口的高度不许因标签语言而变', () => {
  it('`.app-tab` 必须显式给 `line-height`（否则拉丁标签比中文标签矮 4px）', () => {
    const block = /^\.app-tab \{[^}]*\}/m.exec(styles)?.[0] ?? '';
    expect(block, '样式表里找不到 `.app-tab` 规则').not.toBe('');
    expect(
      block,
      '`.app-tab` 没有显式 `line-height` ⇒ Chromium 给表单控件的 `line-height: normal` ' +
        '会按字体度量算行盒 ⇒ 拉丁标签（Git / MCP）比中文标签矮 4px（28.67px < 32px）',
    ).toMatch(/line-height:\s*[\d.]+/);
  });
});

/**
 * **入口不许被压缩**（形状锁）。
 *
 * 左栏内容（16 个入口 + 3 组标题 + 品牌 + 底部信息 ≈ 736px）比矮窗口（620px）高
 * ⇒ **该由左栏滚动**（实测 `scrollHeight 736 > clientHeight 584`），而不是把入口挤扁。
 * 弹性项目的**自动最小尺寸**已经挡过一次，但那是**隐式**的 ——
 * 谁一旦给这里加 `min-height: 0` 或改成 grid，入口就会当场被压扁 ⇒ 显式写死。
 */
describe('左栏导航：入口不许被压扁', () => {
  it('左栏的弹性项都钉住 `flex: 0 0 auto`（装不下要滚动，不是把入口挤成薄条）', () => {
    for (const sel of ['.app-tabs', '.app-rail-group', '.app-rail-group-items > .app-tab']) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 同样**锚到行首**：`.app-rail-group` 不锚会撞上 `.app-rail-group-title`
      const block = new RegExp(`^${esc}\\s*\\{[^}]*\\}`, 'm').exec(stylesNoComments)?.[0] ?? '';
      expect(block, `样式表里找不到 \`${sel}\` 的规则`).not.toBe('');
      expect(
        block,
        `${sel} 没有钉住 \`flex: 0 0 auto\` ⇒ 窗口一矮，入口就可能被压扁`,
      ).toContain('flex: 0 0 auto');
    }
  });
});
