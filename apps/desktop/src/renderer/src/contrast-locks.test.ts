import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * R74 · **对比度锁**（令牌层那一层）
 *
 * ## 为什么立它
 *
 * R74 的离屏现扫（全站 **17 屏 · 587 个文字元素测量点**）里，**唯一**一条不过 WCAG AA 的是
 * 概览页日志里的 scope 标签：`code.jj-log-scope` 的字色是主色那一档，
 * 而它压着的标签底是「通用 `code` 规则的 `--c-overlay-weak`（白 8%）叠在卡片底 `--c-bg-container` 上」
 * ⇒ 合成后底色比卡片底**更亮** ⇒ 主色压上去只有 **4.07:1**（12px 普通文本要 ≥ 4.5）。
 *
 * 也就是说：这条破口能静静躺在仓里很多轮 —— 因为**没有任何门禁量过文字对比度**
 * （e2e 也没有：那一步在 R74 才补上）。⇒ 这里补一条**快锁**：不跑浏览器，直接按**令牌真值**算。
 *
 * ## 为什么按令牌算、而不是把 4.07 写死
 *
 * 写死的数会漂：标签底（`--c-overlay-weak`）、卡片底（`--c-bg-container`）、字色令牌
 * 任何一处变了，真实对比度就变了，而写死的断言还在 ⇒ 变成一句"曾经为真的话"。
 * ⇒ 本锁**每次都从样式表里现读**：`.jj-log-scope` 的字色令牌 → `code` 的底色令牌 → `.p0-card` 的底色令牌
 * → 令牌层的真值 ⇒ 合成 ⇒ 算 WCAG 对比度。**改了令牌，它自己重算。**
 *
 * ## 覆盖面（**只管这一处**，不假装更大）
 *
 * 它判的是「概览页日志 scope 标签这一处文字，在它实际压着的底色上，必须过 AA 4.5:1」。
 * 全站面上的对比度由 R74 那条 e2e 扫描负责（真窗口实测），**不在本锁的承诺范围内**。
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const styles = read('./styles.css');
const motion = read('./styles/motion.css');
/**
 * 剥注释再判 —— R54 的教训（⑫ 那条锁第一版被自己的注释喂饱 ⇒ 假绿）。
 * 本文件里那段注释恰好写着 `.jj-log-scope` 与 `var(--c-primary-hover)` ⇒ 不剥就等于"注释替声明作证"。
 */
const stylesNoComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');
const motionNoComments = motion.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 解析 `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()`；认不出就返回 null（⇒ 判据失焦） */
const parseColor = (raw: string): Rgb | null => {
  const v = raw.trim();
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(v);
  if (hex !== null) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: alpha,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb !== null) {
    const parts = (rgb[1] ?? '')
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return {
      r: parts[0] ?? 0,
      g: parts[1] ?? 0,
      b: parts[2] ?? 0,
      a: parts.length > 3 ? (parts[3] ?? 1) : 1,
    };
  }
  return null;
};

const toHex = (c: Rgb): string =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('');

/** 半透明前景叠在底色上（浏览器的那套 alpha 合成） */
const composite = (fg: Rgb, bg: Rgb): Rgb => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

/** WCAG 2.x 相对亮度 */
const luminance = (c: Rgb): number => {
  const f = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};

/** WCAG 2.x 对比度 */
const contrastRatio = (a: Rgb, b: Rgb): number => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * 令牌表：`--c-*` 的真值住在令牌层（`styles/motion.css` 的 `:root`），
 * 而渲染层自己那几个别名（`--bg-container: var(--c-bg-container)`）住在 `styles.css` 的 `:root`。
 * ⇒ 两张表合并成一张，**别名链**在 `resolve` 里跟进。
 */
const tokenTable = new Map<string, string>();
for (const m of motionNoComments.matchAll(/(--c-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  tokenTable.set(m[1] ?? '', (m[2] ?? '').trim());
}
for (const m of stylesNoComments.matchAll(/(--[a-z0-9-]+)\s*:\s*var\((--c-[a-z0-9-]+)\)\s*;/g)) {
  tokenTable.set(m[1] ?? '', `var(${m[2] ?? ''})`);
}

/** 跟进别名链，拿到字面值（认不出就返回空串 ⇒ 判据失焦 ⇒ 用例红） */
const resolve = (name: string, depth = 0): string => {
  const v = tokenTable.get(name);
  if (v === undefined) return '';
  const inner = /^var\((--c-[a-z0-9-]+)\)$/.exec(v);
  if (inner !== null && depth < 5) return resolve(inner[1] ?? '', depth + 1);
  return v;
};

/** 取一条规则的内容（`selector { … }`）；找不到就返回空串 */
const ruleBody = (css: string, selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
  return m === null ? '' : (m[1] ?? '');
};

/** 取一条声明的值 */
const declValue = (body: string, prop: string): string => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m === null ? '' : (m[1] ?? '').trim();
};

/** 取一条声明的**令牌名**（只认 `var(--c-*)` 形式 —— 写死的颜色另有第 34 条判据管） */
const declToken = (body: string, prop: string): string => {
  const v = declValue(body, prop);
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  return m === null ? '' : (m[1] ?? '');
};

describe('R74 · 对比度锁：日志 scope 标签的字压在标签底上必须过 AA', () => {
  const scopeColorToken = declToken(ruleBody(stylesNoComments, '.jj-log-scope'), 'color');
  const badgeBgToken = declToken(ruleBody(stylesNoComments, 'code'), 'background');
  const cardBgToken = declToken(ruleBody(stylesNoComments, '.p0-card'), 'background');

  it('判据没有失焦：三条规则与三个令牌都还找得到', () => {
    // 失焦比失守更坏：判据量不到东西时它会一直绿 ⇒ 这一条先把"量不到"变成红
    expect(scopeColorToken, 'styles.css 里找不到 `.jj-log-scope` 的 color 令牌').not.toBe('');
    expect(badgeBgToken, 'styles.css 里找不到 `code` 的 background 令牌').not.toBe('');
    expect(cardBgToken, 'styles.css 里找不到 `.p0-card` 的 background 令牌').not.toBe('');
    expect(resolve(scopeColorToken), `令牌层里没有 ${scopeColorToken}`).not.toBe('');
    expect(resolve(badgeBgToken), `令牌层里没有 ${badgeBgToken}`).not.toBe('');
    expect(resolve(cardBgToken), `令牌层里没有 ${cardBgToken}`).not.toBe('');
  });

  it('scope 标签：字色压在「标签底叠卡片底」上要 ≥ 4.5:1（12px 普通文本的 AA）', () => {
    const fg = parseColor(resolve(scopeColorToken));
    const badge = parseColor(resolve(badgeBgToken));
    const card = parseColor(resolve(cardBgToken));
    expect(fg, `字色令牌 ${scopeColorToken} 的值认不出：${resolve(scopeColorToken)}`).not.toBeNull();
    expect(badge, `标签底令牌 ${badgeBgToken} 的值认不出：${resolve(badgeBgToken)}`).not.toBeNull();
    expect(card, `卡片底令牌 ${cardBgToken} 的值认不出：${resolve(cardBgToken)}`).not.toBeNull();
    const bg = composite(badge as Rgb, card as Rgb);
    const ratio = contrastRatio(fg as Rgb, bg);
    expect(
      ratio,
      `scope 字色 ${toHex(fg as Rgb)} 压在标签底 ${toHex(bg)}（= ${toHex(card as Rgb)} + 白 8%）上只有 ` +
        `${ratio.toFixed(2)}:1，低于 AA 的 4.5:1（R74 现扫实测值：主色那一档是 4.07:1）`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});
