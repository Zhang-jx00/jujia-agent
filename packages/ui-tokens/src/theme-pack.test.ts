import { describe, expect, it } from 'vitest';
import {
  checkContrast,
  checkPrimaryUsable,
  mergePackOverrides,
  contrastRatio,
  BUILTIN_PACKS,
  DEFAULT_BACKGROUND,
  pickPrimaryInk,
  relativeLuminance,
  suggestUsablePrimary,
  THEME_PACK_VAR_KEYS,
  themePackToCssVars,
  validateThemePack,
} from './theme-pack';

/**
 * 外观样式包的验收重点：
 * 1. **受控字段**：未知字段、任意 CSS/JS、可疑 URL 一律整包拒绝（防 XSS/RCE）；
 * 2. **范围校验**：数值字段越界要报错，不静默夹紧；
 * 3. **对比度守护**：不达标要给建议与可用的修复色；
 * 4. **不假装校验过**：图片/渐变背景无法精确算对比度时如实标注。
 */

function valid(): Record<string, unknown> {
  return {
    id: 'my-pack',
    name: '我的样式',
    version: 1,
    dialog: { bubbleShape: 'pill', density: 'compact' },
    background: { kind: 'solid', color: '#101820' },
    primary: '#4c8dff',
  };
}

describe('validateThemePack：受控字段', () => {
  it('合法包通过并套用默认值', () => {
    const r = validateThemePack(valid());
    expect(r.ok).toBe(true);
    expect(r.pack?.dialog.bubbleShape).toBe('pill');
    expect(r.pack?.dialog.maxBubbleWidthPct).toBe(88); // 未提供 → 默认
    expect(r.errors).toEqual([]);
  });

  it('内置样式包全部合法（防止我们自己写错）', () => {
    for (const p of BUILTIN_PACKS) {
      const r = validateThemePack(p);
      expect(r.ok, `${p.id}: ${r.errors.join('; ')}`).toBe(true);
    }
  });

  it('未知字段 → 整包拒绝（只允许受控字段）', () => {
    const r = validateThemePack({ ...valid(), customCss: '.x{color:red}' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('未知字段');
  });

  it('dialog 里的未知字段同样拒绝', () => {
    const r = validateThemePack({ ...valid(), dialog: { bubbleShape: 'pill', inject: 'x' } });
    expect(r.ok).toBe(false);
  });

  it.each([
    ['CSS 规则块', 'color: red } .evil { display:none'],
    ['script 标签', '<script>alert(1)</script>'],
    ['javascript: 伪协议', 'javascript:alert(1)'],
    ['expression()', 'expression(alert(1))'],
    ['任意 url()', 'url(https://evil.test/x.png)'],
    ['@import', '@import "evil.css"'],
    ['反斜杠转义', 'red\\; background:url(x)'],
  ])('名称/颜色里出现 %s → 拒绝', (_name, evil) => {
    const r = validateThemePack({ ...valid(), name: evil });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/拒绝|未知/);
  });

  it('图片地址只允许 http(s) 或本机绝对路径（拒绝 data:/file:/javascript:）', () => {
    const base = { ...valid(), background: { kind: 'image' } };
    for (const bad of [
      'data:image/svg+xml;base64,PHN2Zz4=',
      'file:///C:/secret.png',
      'javascript:alert(1)',
      'ftp://x/y.png',
    ]) {
      const r = validateThemePack({ ...base, background: { kind: 'image', imageUrl: bad } });
      expect(r.ok, bad).toBe(false);
    }
    expect(validateThemePack({ ...base, background: { kind: 'image', imageUrl: 'https://x.test/a.png' } }).ok).toBe(true);
    expect(validateThemePack({ ...base, background: { kind: 'image', imageUrl: 'D:\\pics\\bg.png' } }).ok).toBe(true);
  });

  it('数值越界要报错，不静默夹紧', () => {
    const r = validateThemePack({ ...valid(), dialog: { ...valid()['dialog'] as object, radiusPx: 999 } });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('超出允许范围');
  });

  it('枚举值非法要报错', () => {
    const r = validateThemePack({ ...valid(), dialog: { bubbleShape: 'hexagon' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('bubbleShape');
  });

  it('kind=gradient 缺 from/to → 报错', () => {
    const r = validateThemePack({ ...valid(), background: { kind: 'gradient' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('from');
  });

  it('kind=image 缺 imageUrl → 报错', () => {
    const r = validateThemePack({ ...valid(), background: { kind: 'image' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('imageUrl');
  });

  it('非对象输入被拒', () => {
    expect(validateThemePack('x').ok).toBe(false);
    expect(validateThemePack(null).ok).toBe(false);
    expect(validateThemePack([]).ok).toBe(false);
  });

  it('version 必须为 1（为将来的迁移留位）', () => {
    expect(validateThemePack({ ...valid(), version: 2 }).ok).toBe(false);
  });
});

describe('对比度守护', () => {
  it('相对亮度与对比度计算正确（黑白为 21:1）', () => {
    expect(contrastRatio('#000000', '#ffffff') as number).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff') as number).toBeCloseTo(1, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });

  it('支持 3 位缩写与 8 位带 alpha', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#ffffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('nonsense')).toBeNull();
  });

  it('深色背景 + 浅色文字 → 达标', () => {
    const r = checkContrast(DEFAULT_BACKGROUND, '#f5f5f5');
    expect(r.ok).toBe(true);
    expect(r.ratio as number).toBeGreaterThan(4.5);
  });

  it('浅色背景 + 浅色文字 → 不达标，给出建议与修复色', () => {
    const r = checkContrast({ kind: 'solid', color: '#ffffff' }, '#f5f5f5');
    expect(r.ok).toBe(false);
    expect(r.advice).toContain('WCAG AA');
    expect(r.suggestedForeground).toBe('#111111'); // 亮背景应给深色前景
  });

  it('图片/渐变背景：**不假装校验过**，返回保守建议', () => {
    const r = checkContrast({ kind: 'image', imageUrl: 'https://x.test/a.png' });
    expect(r.ok).toBe(true);
    expect(r.ratio).toBeNull();
    expect(r.advice).toContain('无法精确计算');
  });

  it('色值无法解析时如实报不可用', () => {
    const r = checkContrast({ kind: 'solid', color: 'not-a-color' });
    expect(r.ok).toBe(false);
    expect(r.advice).toContain('无法解析');
  });
});

describe('themePackToCssVars：只产出受控变量', () => {
  it('把样式包渲染为 CSS 变量', () => {
    const pack = validateThemePack(valid()).pack;
    const vars = themePackToCssVars(pack!);
    expect(vars['--jj-bubble-radius']).toBe('8px');
    expect(vars['--jj-density-gap']).toBe('6px'); // compact
    expect(vars['--jj-bg-color']).toBe('#101820');
    expect(vars['--jj-primary']).toBe('#4c8dff');
  });

  it('图片背景用 url() 包一层（用户无法自行拼 url()）', () => {
    const pack = validateThemePack({
      ...valid(),
      background: { kind: 'image', imageUrl: 'https://x.test/a.png' },
    }).pack;
    expect(themePackToCssVars(pack!)['--jj-bg-image']).toBe('url("https://x.test/a.png")');
  });

  it('不产出任何自由形式的 CSS 文本键', () => {
    const pack = validateThemePack(valid()).pack;
    const keys = Object.keys(themePackToCssVars(pack!));
    expect(keys.every((k) => k.startsWith('--jj-'))).toBe(true);
  });
});

/**
 * R58 · T79：**主色接上线之后的那些判定**。
 *
 * 为什么这一组用例是承重的：主色一旦真的接到渲染层，它就同时管三件事 ——
 * ① 按钮底色 ② 按钮上的字色 ③ 焦点环与边框。
 * ⇒ "这个主色行不行"必须**逐条**答，而不是"看着挺好看"。
 */
describe('主色可用性（R58 · T79）', () => {
  it('按钮字色跟着主色走：深主色用白字、浅主色用 #101010', () => {
    /**
     * 深主色 #1a2b3c：固定 #101010 时对比只有 **1.33:1** ⇒ 按钮看不见。
     * 这正是 R54 撤回接线的那条理由（"字色固定 ⇒ 深主色下按钮消失"）⇒ 现在它有兜底了。
     */
    const dark = checkPrimaryUsable('#1a2b3c');
    expect(dark.ink).toBe('#ffffff');
    expect(dark.inkRatio).not.toBeNull();
    expect(dark.inkRatio!).toBeGreaterThanOrEqual(4.5);

    /** 浅主色 #f0f0f0：白字压上去只有 1.14:1 ⇒ 必须用深字 */
    const light = checkPrimaryUsable('#f0f0f0');
    expect(light.ink).toBe('#101010');
    expect(light.inkRatio!).toBeGreaterThanOrEqual(4.5);

    expect(pickPrimaryInk('#1a2b3c')).toBe('#ffffff');
    expect(pickPrimaryInk('#f0f0f0')).toBe('#101010');
  });

  it('四个内置包的主色都可用（"内置包不会触发闸门"是证过的，不是假设）', () => {
    for (const p of BUILTIN_PACKS) {
      const v = checkPrimaryUsable(p.primary!);
      expect(v.ok, `${p.id} 的主色 ${p.primary} 不可用：${v.advice ?? ''}`).toBe(true);
    }
  });

  it('四个内置包的按钮字色都还是 #101010 ⇒ 渲染结果与接线前一致（e2e 那条 5.94:1 不变）', () => {
    for (const p of BUILTIN_PACKS) {
      expect(pickPrimaryInk(p.primary!), `${p.id} 的字色变了`).toBe('#101010');
    }
  });

  it('闸门：太深的主色被拒（焦点环会消失在深色界面上）', () => {
    const v = checkPrimaryUsable('#1a2b3c');
    expect(v.ok).toBe(false);
    expect(v.surfaceRatio).not.toBeNull();
    expect(v.surfaceRatio!).toBeLessThan(3);
    expect(v.advice).toContain('焦点环');
  });

  it('闸门：灰带主色被拒（#787878 —— 两种字色都到不了 4.5:1）', () => {
    const v = checkPrimaryUsable('#787878');
    expect(v.ok).toBe(false);
    // 两种字色都不过 AA ⇒ 不是"选一个没那么差的"，是两个都不行
    expect(contrastRatio('#101010', '#787878')!).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#787878')!).toBeLessThan(4.5);
    expect(v.inkRatio!).toBeLessThan(4.5);
    // 焦点环这一项它是好的 ⇒ 错在字色，不在主色本身
    expect(v.surfaceRatio!).toBeGreaterThanOrEqual(3);
    expect(v.advice).toContain('4.5');
  });

  it('建议色：给得出、改完真的可用、且与原色不同', () => {
    const s = suggestUsablePrimary('#787878');
    expect(s).toBeDefined();
    expect(s).not.toBe('#787878');
    expect(checkPrimaryUsable(s!).ok).toBe(true);
  });

  it('没有主色的包不产出主色与字色（字色回落默认 ⇒ 渲染不变）', () => {
    const raw = valid();
    delete raw['primary'];
    const pack = validateThemePack(raw).pack!;
    const vars = themePackToCssVars(pack);
    expect(vars['--jj-primary']).toBeUndefined();
    expect(vars['--jj-primary-ink']).toBeUndefined();
  });

  it('产出变量表与「可能产出的全部变量」清单两向对齐', () => {
    /**
     * 为什么两向都查：
     * - 只查"产出 ⊆ 清单" ⇒ 清单漏一个键 ⇒ 那个变量**永远清不掉**（换包后残值赖着不走）；
     * - 只查"清单 ⊆ 产出" ⇒ 清单里可以有死项 ⇒ 清单在骗人（读的人以为它管着那个变量）。
     */
    const maximals = [
      { ...valid(), background: { kind: 'solid', color: '#101820', opacity: 0.8, blurPx: 4 } },
      { ...valid(), background: { kind: 'gradient', from: '#1b2440', to: '#0f1117' } },
      { ...valid(), background: { kind: 'image', imageUrl: 'https://x.test/a.png' } },
    ];
    const produced = new Set<string>();
    for (const raw of maximals) {
      const pack = validateThemePack(raw).pack!;
      for (const k of Object.keys(themePackToCssVars(pack))) produced.add(k);
    }
    const listed = THEME_PACK_VAR_KEYS as readonly string[];
    expect([...produced].filter((k) => !listed.includes(k))).toEqual([]);
    expect([...THEME_PACK_VAR_KEYS].filter((k) => !produced.has(k))).toEqual([]);
  });
});

describe('mergePackOverrides：只覆盖指定项，且**合并结果必须重新过校验**', () => {
  const base = BUILTIN_PACKS[0]!;

  it('只覆盖背景色时，其余字段保持基准值', () => {
    const r = mergePackOverrides(base, { background: { color: '#101820' } });
    expect(r.ok).toBe(true);
    expect(r.pack?.background.color).toBe('#101820');
    expect(r.pack?.dialog.bubbleShape).toBe(base.dialog.bubbleShape);
  });

  it('非法覆盖被拒绝（不允许借合并绕过受控字段）', () => {
    const r = mergePackOverrides(base, { background: { color: 'red; background:url(x)' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('拒绝');
  });

  it('越界数值被拒绝', () => {
    const r = mergePackOverrides(base, { dialog: { radiusPx: 999 } });
    expect(r.ok).toBe(false);
  });

  it('不修改基准对象（纯函数）', () => {
    const before = JSON.stringify(base);
    mergePackOverrides(base, { background: { color: '#000000' } });
    expect(JSON.stringify(base)).toBe(before);
  });
});
