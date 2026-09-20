import { describe, expect, it } from 'vitest';
import {
  checkContrast,
  contrastRatio,
  BUILTIN_PACKS,
  DEFAULT_BACKGROUND,
  relativeLuminance,
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
