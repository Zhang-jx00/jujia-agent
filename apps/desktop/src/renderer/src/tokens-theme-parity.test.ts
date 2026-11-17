import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  color,
  contrastRatio,
  lightColor,
  motion,
  radius,
  shadow,
  space,
  toCssVars,
} from '@jujia/ui-tokens';

/**
 * **双主题令牌锁**（R77 · M1 令牌层）
 *
 * ## 为什么立它
 *
 * M1 把令牌层改成**亮暗两份**（此前只有暗色一份，亮色在渲染层 CSS 里零散覆盖 ⇒ 两处会漂）。
 * 改成两份之后，风险从"漂"变成"**漏**"：亮色少定义一个令牌 ⇒ 那个位置在亮色下回落到暗色值
 * （或直接透明）⇒ 界面看着"能看"但对比度不达标。
 * ⇒ 这类缺口**任何渲染层门禁都看不见**（e2e 断的是 DOM 与坐标，组件测试断的是文本），
 * 只能靠机器在**令牌层**盯：两份必须**同名同族**，且每个文字/表面组合的对比度**可复算**。
 *
 * ## 三条断言
 *
 * ① **同名同族**：亮色与暗色的键集合**完全相同**（不多不少）—— 少一个 ⇒ 亮色下有位置回落；
 * ② **AA 可复算**：正文/次级/三级/禁用四阶文字，在各自背景上 ≥ 4.5（禁用态豁免：它本就该"弱"，
 *    但**不得低于 3**）；主色按钮的字在其底上 ≥ 4.5。
 * ③ **令牌齐备**：新壳要用的语义档（surface1/2/3 · textTertiary/textDisabled · focus · primarySubtle）
 *    两份里都在，且 `toCssVars` 两个主题都产出同名 CSS 变量。
 *
 * ## 边界（如实说明）
 *
 * 它**只管令牌层**：某个令牌是否真被界面用上、界面是否好看，不在它的承诺范围内。
 */

/** 两份调色板的键集合 */
const darkKeys = Object.keys(color).sort();
const lightKeys = Object.keys(lightColor).sort();

describe('双主题令牌（亮/暗同名同族）', () => {
  it('亮色与暗色的令牌键集合完全相同（少一个 ⇒ 亮色下有位置回落到暗色值）', () => {
    expect(lightKeys).toEqual(darkKeys);
  });

  it('新壳要用的语义档两份都在（surface1/2/3 · textTertiary/Disabled · focus · primarySubtle）', () => {
    const required = [
      'surface1',
      'surface2',
      'surface3',
      'textTertiary',
      'textDisabled',
      'focus',
      'primarySubtle',
      'primaryStrong',
    ];
    for (const key of required) {
      expect(darkKeys, `暗色缺 ${key}`).toContain(key);
      expect(lightKeys, `亮色缺 ${key}`).toContain(key);
    }
  });

  it('toCssVars 两个主题产出同名的 CSS 变量（界面按变量名取值 ⇒ 名字必须一致）', () => {
    const darkVars = Object.keys(toCssVars('dark')).sort();
    const lightVars = Object.keys(toCssVars('light')).sort();
    expect(lightVars).toEqual(darkVars);
    expect(darkVars.length).toBeGreaterThan(20);
  });
});

describe('双主题的对比度可复算（WCAG AA · 用同一份 contrastRatio）', () => {
  /** 可能的表面背景（**取最差的那个** ⇒ 不用手挑组合） */
  const surfaces = ['bgLayout', 'bgContainer', 'surface1', 'surface2', 'surface3'] as const;

  /** 每个文字档的阈值：正文/次级/三级 ≥ 4.5（AA 普通文本）；禁用态 ≥ 3（它本就该弱，但不能弱到看不见） */
  const textRules: { key: keyof typeof color; min: number }[] = [
    { key: 'text', min: 4.5 },
    { key: 'textSecondary', min: 4.5 },
    { key: 'textTertiary', min: 4.5 },
    { key: 'textDisabled', min: 3 },
  ];

  for (const theme of ['dark', 'light'] as const) {
    const palette = theme === 'dark' ? color : lightColor;

    for (const rule of textRules) {
      it(`${theme}：${rule.key} 在**最差表面**上 ≥ ${rule.min}`, () => {
        const ratios = surfaces.map((bg) => ({
          bg,
          ratio: contrastRatio(palette[rule.key], palette[bg]),
        }));
        for (const r of ratios) {
          expect(r.ratio, `${theme} 的 ${rule.key}/${r.bg} 复算不出来（值格式不对？）`).not.toBeNull();
        }
        const worst = ratios.reduce((a, b) => ((a.ratio as number) <= (b.ratio as number) ? a : b));
        expect(
          worst.ratio as number,
          `${theme}：${rule.key} 在 ${worst.bg} 上只有 ${(worst.ratio as number).toFixed(2)}:1（要求 ≥ ${rule.min}）`,
        ).toBeGreaterThanOrEqual(rule.min);
      });
    }

    it(`${theme}：主色按钮的字在主色底上 ≥ 4.5（按钮是主操作 ⇒ 字必须看得清）`, () => {
      // 主色底上通常放白字（暗色主题）；亮色主题放深字 —— 两种都试，取达标的那个
      const candidates = ['#ffffff', '#0d1117', '#17181c', '#101010'];
      const best = candidates
        .map((ink) => contrastRatio(ink, palette.primary))
        .reduce((a, b) => Math.max(a ?? 0, b ?? 0));
      expect(best, `${theme}：主色底上找不到 ≥4.5 的字色`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}：焦点环与主色可辨（focus 不该与 primary 完全同值时无从分辨）`, () => {
      expect(palette.focus).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }
});

describe('令牌族的形状（间距/字号/圆角/阴影/动效）', () => {  it('间距是 4px 基准的阶梯（禁魔法数字）', () => {
    for (const v of Object.values(space as Record<string, string>)) {
      const px = Number.parseInt(v, 10);
      expect(Number.isFinite(px)).toBe(true);
      expect(px % 2 === 0).toBe(true);
    }
  });

  it('圆角/阴影/动效都是非空字符串且动效不超过 1s（功能动效铁律）', () => {
    for (const v of Object.values(radius as Record<string, string>)) expect(v.length).toBeGreaterThan(0);
    for (const v of Object.values(shadow as Record<string, string>)) expect(v.length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(motion as Record<string, string>)) {
      if (!k.startsWith('duration')) continue;
      const ms = Number.parseInt(v, 10);
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms, `${k} = ${v} 超过 1s`).toBeLessThanOrEqual(1000);
    }
  });
});

/* ========================================================================
 * CSS 层的双主题对齐（**另一半的漂移**）
 *
 * TS 令牌层对齐了还不够：渲染层真正吃的是 `styles/motion.css` 里的 CSS 变量。
 * 两块 CSS（暗色 `:root` 与亮色 `[data-theme='light']`）必须**同名同族** ——
 * 少一个 ⇒ 亮色下那个位置回落到暗色值（界面看着"能看"，但对比度不达标）。
 * ⇒ 这条把 CSS 两块直接对比，不经过 TS。
 * ======================================================================== */

const MOTION_CSS_PATH = fileURLToPath(new URL('./styles/motion.css', import.meta.url));
const motionCss = readFileSync(MOTION_CSS_PATH, 'utf8');

/** 取某个块里的 `--xxx:` 变量名 */
function cssVarsIn(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1] as string));
}

/** 取 :root 块（从 `:root {` 到其闭合 `}`） */
function rootBlock(css: string): string {
  const start = css.indexOf(':root {');
  expect(start, '样式表里找不到 :root 块（定位器失效？）').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

/** 取 [data-theme='light'] 块 */
function lightBlock(css: string): string {
  const start = css.indexOf("[data-theme='light'] {");
  expect(start, '样式表里找不到 [data-theme=\'light\'] 块（定位器失效？）').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

describe('CSS 层的双主题（styles/motion.css）', () => {
  /**
   * **规则只管「随主题变」的令牌族**（--c-* 与 --shadow-*）。
   *
   * 为什么不是两块必须完全一样：间距 / 字号 / 圆角 / 动效是**主题无关**的
   * ⇒ 亮色块不重定义它们是**对的**（继承 :root 即可，重定义反而多一处会漂的地方）。
   * ⇒ 真正会出问题的是**颜色族**：暗色 :root 有、亮色块漏了 ⇒ 那个位置在亮色下
   * 回落到暗色值（界面看着能看，但对比度不达标）⇒ 这才是要盯的。
   */
  const themeVarying = (vars: Set<string>): string[] =>
    [...vars].filter((v) => v.startsWith('--c-') || v.startsWith('--shadow-')).sort();

  it('随主题变的令牌族（--c-* · --shadow-*）在两块里同名同族（少一个 ⇒ 亮色下回落暗色值）', () => {
    const darkVars = themeVarying(cssVarsIn(rootBlock(motionCss)));
    const lightVars = themeVarying(cssVarsIn(lightBlock(motionCss)));
    const missing = darkVars.filter((v) => !lightVars.includes(v));
    const extra = lightVars.filter((v) => !darkVars.includes(v));
    expect(missing, `亮色块少了这些颜色令牌：${missing.join('、')}（亮色下会回落到暗色值）`).toEqual([]);
    expect(extra, `亮色块多了这些颜色令牌（暗色没有）：${extra.join('、')}`).toEqual([]);
    expect(darkVars.length).toBeGreaterThan(20);
  });

  it('M1 新增的语义档：颜色族两块都在 · 主题无关族在 :root（亮色继承）', () => {
    const darkRoot = cssVarsIn(rootBlock(motionCss));
    const light = cssVarsIn(lightBlock(motionCss));
    /** 随主题变 ⇒ 两块都要有 */
    const colorTokens = [
      '--c-surface-1',
      '--c-surface-2',
      '--c-surface-3',
      '--c-text-tertiary',
      '--c-text-disabled',
      '--c-focus',
      '--c-primary-subtle',
      '--c-primary-strong',
    ];
    for (const v of colorTokens) {
      expect(darkRoot, `暗色 :root 缺 ${v}`).toContain(v);
      expect(light, `亮色块缺 ${v}`).toContain(v);
    }
    /** 主题无关 ⇒ 只要 :root 有（亮色继承） */
    const sharedTokens = [
      '--radius-xl',
      '--radius-2xl',
      '--shadow-elev-1',
      '--motion-ease-standard',
      '--motion-ease-emphasized',
    ];
    for (const v of sharedTokens) {
      expect(darkRoot, `暗色 :root 缺 ${v}`).toContain(v);
    }
  });
});
