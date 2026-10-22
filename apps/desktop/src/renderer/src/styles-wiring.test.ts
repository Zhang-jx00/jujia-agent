import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **样式接线锁（CSS 版）**（复核 049 的新要求：把"靠 grep + 人眼"变成机器）。
 *
 * 为什么立它：B1 那一轮 `styles.css` 差点整份漏提交 —— 它一直在工作树里、门禁跑的就是含它的树，
 * 只是 `git add` 清单漏了这个路径（自查补装救回）。而样式缺失**门禁全都不咬**：e2e 断的是 DOM 与坐标，
 * 组件测试断的是文本，谁也看不见"这个 class 在样式表里根本没有规则"。
 *
 * 这个锁的问法很朴素：**渲染层源码里在 className 上引用的类名，必须在渲染层的样式表里有规则**。
 * - 范围 = 本仓自研 UI 的六个前缀（jj / p0 / w2 / w3 / w5 / app）；第三方类名（react-flow__ 等）不在此列；
 * - 样式表 = `renderer/src` 下的**全部** `.css`（`styles.css` + `styles/motion.css` —— 后者住着动效类）；
 * - 只看 `className=` 后面真正那段值（字符串 / 模板 / 花括号表达式）—— `id` / `htmlFor` 里的东西不算类名；
 * - 动态拼接（`jj-canvas-node-${status}`）按**前缀段**检查：能拦"整块样式没进样式表"（本轮的形状），
 *   拦不住"某一个变体漏了"（如实登记为边界）。
 *
 * 两条防失焦断言（同 WORK-PROTOCOL 第 31 条的精神）：① 扫到的类名总数有下限 —— 扫描路径写坏时
 * 会先在数量上红，而不是空转通过；② 样式表合计长度有下限。
 */

/** className= 那段值的边界（`"` 直取；`{` 花括号配平，跳过单双引号字符串与模板串） */
function endOfClassNameValue(text: string, start: number): number {
  if (text[start] === '"') return text.indexOf('"', start + 1);
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i += 1;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
    } else if (ch === '`') {
      i += 1;
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '$' && text[i + 1] === '{') depth += 1;
        else if (text[i] === '}' && depth > 0) depth -= 1;
        i += 1;
      }
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return text.length - 1;
}

/** 只取 className 属性上的类名（id / htmlFor / aria 里的 jj- 前缀不算 —— 那类「命名空间复用」不是类） */
function classNamesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/className\s*=\s*/g)) {
    const start = m.index + m[0].length;
    const end = endOfClassNameValue(text, start);
    const region = text.slice(start, end + 1);
    for (const t of region.matchAll(/\b(?:jj|p0|w2|w3|w5|app)-[a-z0-9-]*\b/g)) out.add(t[0]);
  }
  return out;
}

function collect(globDir: string): { sources: string[]; css: string } {
  const sources: string[] = [];
  const cssParts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full);
      else if (/\.css$/.test(e.name)) cssParts.push(readFileSync(full, 'utf8'));
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) sources.push(readFileSync(full, 'utf8'));
    }
  };
  walk(globDir);
  return { sources, css: cssParts.join('\n') };
}

/**
 * **样式接线锁（R54 · UI 现扫补的两条）**。
 *
 * 为什么单列：现扫（真窗口量）查出的洞里，这两条是**"声明没写对"**而不是"画错了"：
 *   ⑪ 全仓 `::placeholder` 规则 **0 条** ⇒ 占位符用的是 **Chromium 出厂默认的 #757575**（3.58:1）；
 *   ⑫ `input[type='color']` 写了 `width: 100%` ⇒ 那个控件被拉成 **1178×32** 的一根空长条。
 * ⇒ 这两条用**声明层**的锁最省事、也最不容易被"合法增长"带偏；**渲染层**的结果由 e2e 渲染契约量
 * （⑧ 所有 button 命中区 ≥32×32 · ⑨ 主操作按钮对比 ≥4.5 · ⑩ 占位符色 = 令牌色）。
 *
 * **第三条（主题包主色 `--jj-primary`）· R58 补上**：
 * 现扫确实查出「`--jj-primary` 渲染层无人读」，R54 的第一版实现也真的接上了 —— 但**复核后撤回了**：
 *   ① 现扫自己把它列为「**产品决定**」，不该在 UI 打磨轮顺手定；
 *   ② 它那时是**惰性**字段，接上就变"活的"：用户导入一个深主色 ⇒ 主按钮底色变深、字色固定 #101010
 *      ⇒ 对比度可低到 1:1（按钮看不见）；4 个内置包实测主色是 #4c8dff / #4c8dff / #6ba0ff / #8ab4ff
 *      （**不是**"全是 #4c8dff"），但面板**没有**主色选择器，只有 JSON 导入能带任意主色；
 *   ③ 补闸门要动 `validateThemePack` —— 它**管着启动时加载已保存的样式包**，在那里硬拒绝
 *      会把用户**已存**的包静默退回默认包。
 * ⇒ **R58（T79）把接线与闸门一起做了**：① 字色改为跟随主色（`--primary-ink` ⇒ `--jj-primary-ink`），
 *   ② 闸门放在**导入侧**（**不动** `validateThemePack` 的加载语义），
 *   ③ 换包时**清残值**（`setProperty` 只写不清 ⇒ 不清就会"换包后主色还是上一个包的"）。
 * ⇒ 这两条由**样式层**钉住（接线与字色接线）；**换包后主色真变**由 e2e 渲染契约量。
 */
describe('样式接线锁（UI 现扫补的三条 · ⑪⑫ R54 · ⑬ R58）', () => {
  const { css: cssRaw } = collect(fileURLToPath(new URL('.', import.meta.url)));
  /**
   * **匹配前必须剥注释** —— 这一条是被自己的注释喂饱过的（§11 假锁清单第 5 条：
   * 「锁读原文被注释喂饱」）：⑫ 的第一版把「原来是 `width: 100%`」**写在 CSS 注释里**，
   * 锁去匹配那段说明 ⇒ **第一版就假红**。⇒ 判据只看**真正的声明**。
   */
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

  it('⑪ 必须有 ::placeholder 规则，且用令牌色（Chromium 出厂默认只有 3.58:1）', () => {
    const rule = /::placeholder\s*\{([^}]*)\}/.exec(css);
    expect(rule, '样式表里没有 ::placeholder 规则 ⇒ 占位符会用浏览器出厂默认色').not.toBeNull();
    expect(rule?.[1] ?? '', '::placeholder 规则没有用令牌色').toContain('var(--c-text-secondary)');
  });

  it('⑫ 颜色控件必须被收窄成一个色块的大小（不许写成整行宽）', () => {
    const block = /input\[type='color'\]\s*\{([^}]*)\}/.exec(css);
    expect(block, '样式表里找不到颜色控件的规则').not.toBeNull();
    const body = block?.[1] ?? '';
    // **判据给区间，不给"不许出现某个字面量"** —— 只禁 `width: 100%` 的话，
    // 改成 `width: 1000px` 这类照样绿，而它同样是那根空长条（现扫实测 1178×32）。
    const w = /width:\s*(\d+(?:\.\d+)?)px/.exec(body);
    expect(w, '颜色控件的 width 没有写成 px（看不出它被收窄过）').not.toBeNull();
    const px = Number(w?.[1] ?? '0');
    expect(px, `颜色控件的宽度是 ${String(px)}px（整行宽 ⇒ 一根看不见色块的空长条）`).toBeLessThanOrEqual(
      120,
    );
    expect(px, '颜色控件的宽度太小（连色块都看不见）').toBeGreaterThanOrEqual(32);
  });

  /**
   * ⑬（R58 · T79）：**主题包主色必须真的接到渲染层** —— 接线 + 字色跟随主色。
   *
   * 为什么用**声明层**的锁：这条锁要防的是「接线被拆掉」与「字色被写死」两件事，
   * 而这两件事在**渲染层**的表现要等到换包才看得见（e2e 量的是**结果**，
   * 这里量的是**接线本身** —— 两者互补：e2e 说"主色真的变了"，这条说"它是被谁接上的"）。
   *
   * ⚠️ 判据给的是**完整的 var() 链**（含回落），不是"出现过 `--jj-primary` 这几个字" ——
   * 后者会被注释喂饱（前缀匹配 `var(--jj-primary` 匹配不上 `var(--jj-primary, …)`，
   * 而"只判出现过"匹配得上 ⇒ 两种写法必须分清）。
   */
  it('⑬ 主题包主色接到渲染层，且按钮字色跟着主色走', () => {
    // ① 主色别名：读 `--jj-primary`，**带回落**（没有主色的包 ⇒ 沿用默认主色）
    expect(
      css,
      '`:root` 里的 --primary 没有读 --jj-primary（主题包主色渲染层无人读 ⇒ 换包后主色不变）',
    ).toMatch(/^\s*--primary:\s*var\(--jj-primary,\s*var\(--c-primary\)\)/m);

    // ② 字色别名：读 `--jj-primary-ink`，带回落 `--c-bg-input`（没有主色 ⇒ 与接线前一致）
    expect(css, '没有 --primary-ink 别名（按钮字色没法跟着主色走）').toMatch(
      /^\s*--primary-ink:\s*var\(--jj-primary-ink,\s*var\(--c-bg-input\)\)/m,
    );

    // ③ 主按钮的字色必须用那个别名（**不许写死** `--c-bg-input` —— 那样深主色下按钮看不见）
    const btn = /button\.w2-btn-primary\s*\{([^}]*)\}/.exec(css);
    expect(btn, '样式表里找不到 button.w2-btn-primary 的规则').not.toBeNull();
    expect(btn?.[1] ?? '', '主按钮的字色没有用 --primary-ink（深主色下按钮会看不见）').toMatch(
      /color:\s*var\(--primary-ink\)/,
    );
  });

  /**
   * ⑭⑮⑯（R60 · T78 命中区三族的**声明层**锁）。
   *
   * ## 为什么要有这一层（e2e 已经量了渲染结果）
   *
   * e2e 那条量的是**渲染出来的样子**（慢、且只在真窗口里成立）⇒ 所以再配一层**声明层**：
   * CSS 被改坏时**快档**就能红，不必等 25 分钟的 e2e。
   *
   * ## 为什么**三族分开**写三条
   *
   * T78 的原话：「**其余混进去那条锁就会恒红**（恒绿的锁比没锁更坏）」⇒ 一族一把尺子。
   *   ⑭ **图标按钮族**（浏览器页 ←/→/⟳）⇒ **按钮族标准 ≥32×32**（R54 立的那条）；
   *   ⑮ **原生 radio/checkbox 族**（权限页）⇒ 尺子不是控件自己的盒子，而是「**用户实际能点到的那块**」
   *      （它们**全部被 `<label>` 包着**）⇒ 判**关联 label 的高度 ≥24**（WCAG 2.5.8）；
   *   ⑯ **`<summary>` 族** ⇒ 同 ⑮ 的尺子（**实测 19.2 ⇒ 抬到 24**）。
   *
   * ⚠️ ⑮ 只锁**声明**（label 高度），**判不出"控件有没有被 label 包住"** ⇒ 那是 e2e 的活。
   */
  it('⑭ 图标按钮族：`.jj-icon-btn` 必须有 ≥32 的最小命中区（按钮族标准）', () => {
    const rule = /\.jj-icon-btn\s*\{([^}]*)\}/.exec(css);
    expect(rule, '样式表里没有 .jj-icon-btn 规则（浏览器页那三个图标按钮没有最小命中区）').not.toBeNull();
    const body = rule?.[1] ?? '';
    const minH = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(body);
    const minW = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(body);
    expect(minH, '.jj-icon-btn 没有 min-height（命中区高度无从保证）').not.toBeNull();
    expect(minW, '.jj-icon-btn 没有 min-width').not.toBeNull();
    expect(Number(minH?.[1]), '图标按钮的最小高度不到 32px（本仓按钮族标准）').toBeGreaterThanOrEqual(32);
    expect(Number(minW?.[1]), '图标按钮的最小宽度不到 32px').toBeGreaterThanOrEqual(32);
  });

  it('⑮ 原生控件族：`.jj-perm-mode` 的关联 label 必须有 ≥24 的高度（WCAG 2.5.8）', () => {
    const rule = /\.jj-perm-mode\s*\{([^}]*)\}/.exec(css);
    expect(rule, '样式表里没有 .jj-perm-mode 规则').not.toBeNull();
    const minH = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(rule?.[1] ?? '');
    expect(minH, '.jj-perm-mode 没有 min-height（原生控件的有效命中区无从保证）').not.toBeNull();
    expect(Number(minH?.[1]), '原生控件的关联 label 高度不到 24px').toBeGreaterThanOrEqual(24);
  });

  it('⑯ summary 族：必须有 ≥24 的最小高度（改 display 会让展开三角消失 ⇒ 只认 min-height）', () => {
    const rule = /(^|\})\s*summary\s*\{([^}]*)\}/m.exec(css);
    expect(rule, '样式表里没有全局 summary 规则（三个 <summary> 命中区都是 19.2px）').not.toBeNull();
    const minH = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(rule?.[2] ?? '');
    expect(minH, 'summary 规则里没有 min-height').not.toBeNull();
    expect(Number(minH?.[1]), 'summary 的最小高度不到 24px').toBeGreaterThanOrEqual(24);
    // **不许改 display**：Chromium 的展开三角是 `display: list-item` 的产物
    expect(rule?.[2] ?? '', 'summary 规则里不许改 display（会让展开三角消失）').not.toMatch(/display\s*:/);
  });
});

describe('样式接线锁：className 上引用的类名必须在渲染层样式表里有规则', () => {
  const { sources, css } = collect(fileURLToPath(new URL('.', import.meta.url)));
  const tokens = new Set<string>();
  for (const text of sources) {
    for (const t of classNamesIn(text)) tokens.add(t);
  }

  it('先有下限：扫到的类名数量不能塌（扫描路径写坏时先在这里红，而不是空转通过）', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(tokens.size).toBeGreaterThan(40);
    expect(css.length).toBeGreaterThan(1000);
  });

  it('每一个被引用的类名/前缀段都能在样式表里找到', () => {
    /**
     * 判定分两种（校准实验教出来的，2026-10-07）：
     * - 动态前缀段（以 `-` 结尾，如 `jj-canvas-node-`）：是更长名字的一部分也算 —— 子串即可；
     * - 完整类名：必须**整词**命中（左边不是类名字符、右边也不是）——
     *   否则把 `.jj-align-line` 改名成 `.jj-align-line-calib`（这正是校准时的改名）会被子串放行。
     */
    const hasRule = (t: string): boolean => {
      if (t.endsWith('-')) return css.includes(t);
      return new RegExp(`(^|[^a-z0-9-])${t}(?![a-z0-9-])`).test(css);
    };
    const missing = [...tokens].filter((t) => !hasRule(t)).sort();
    expect(missing).toEqual([]);
  });

  it('受属性门控的样式，必须真的有元素带那个类（R20：背景类型曾经静默不生效）', () => {
    /**
     * 形状：`html[data-jj-bg-kind='gradient'] .app-shell { … }` —— 属性出对了、
     * 规则也在样式表里，**但没有任何元素叫 `.app-shell`**（根容器叫 `.app-root`）
     * ⇒ 主题包的"渐变/图片/玻璃"三个选项谁都选不动画面，且所有门禁都是绿的。
     * 这条锁把"属性门控 → 目标类名"这一跳也钉住：目标类必须出现在渲染层源码里。
     */
    const gated = [...css.matchAll(/\[data-[a-z-]+='[^']*'\]\s+\.([a-z][a-z0-9-]*)/g)].map((m) => m[1] ?? '');
    // 防失焦：先确认真的扫到了这类规则（现在有 4 条），否则扫描写坏会空转通过
    expect(gated.length).toBeGreaterThan(0);
    const sourcesText = sources.join('\n');
    const orphan = [...new Set(gated)].filter((cls) => !sourcesText.includes(cls));
    expect(orphan).toEqual([]);
  });
});
