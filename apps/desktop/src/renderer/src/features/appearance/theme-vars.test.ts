import { describe, expect, it } from 'vitest';
import { THEME_PACK_VAR_KEYS, themePackToCssVars, validateThemePack } from '@jujia/ui-tokens';
import { applyThemeVars, type ThemeVarTarget } from './theme-vars';

/**
 * R58 · T79：**换包时清残值**。
 *
 * 为什么这条要有锁：写 CSS 变量用的是 `setProperty` —— 它**只写不清**。
 * ⇒ 换包时上一个包的变量会赖在 `:root` 上。
 *
 * 今天看不出来，是因为 `--jj-primary` 是**惰性**字段（渲染层没人读）。
 * **一接线就变成真的了**：从「柔和渐变」切回「默认暗色」，
 * `--jj-primary` 还停在上一个包的值上 ⇒ "换包后主色还是上一个包的"
 * ⇒ 于是"主色不变"这个洞被修成"主色变成上一个的"，**一样是坏的**。
 *
 * 同族受害者：`--jj-bg-image`（图片背景）—— 从图片包切到纯色包，图片地址赖着不走。
 */

/** 一只够用的假根元素（**不引 jsdom**：这个函数只需要 style 的两个方法） */
function fakeRoot(): {
  target: ThemeVarTarget;
  get: (key: string) => string | null;
  put: (key: string, value: string) => void;
} {
  const props = new Map<string, string>();
  const target: ThemeVarTarget = {
    style: {
      setProperty: (name, value) => {
        props.set(name, value);
      },
      removeProperty: (name) => {
        props.delete(name);
      },
    },
  };
  return {
    target,
    get: (key) => props.get(key) ?? null,
    put: (key, value) => {
      props.set(key, value);
    },
  };
}

function packOf(raw: Record<string, unknown>) {
  const r = validateThemePack(raw);
  expect(r.ok, r.errors.join('；')).toBe(true);
  return r.pack!;
}

describe('applyThemeVars：先清残值，再写这次的', () => {
  it('换包时，上一个包留下的变量被清掉（图片背景 → 纯色背景）', () => {
    const root = fakeRoot();
    const image = packOf({
      id: 'a',
      name: 'A',
      version: 1,
      dialog: {},
      background: { kind: 'image', imageUrl: 'https://x.test/a.png' },
    });
    const solid = packOf({
      id: 'b',
      name: 'B',
      version: 1,
      dialog: {},
      background: { kind: 'solid', color: '#141414' },
    });

    applyThemeVars(root.target, themePackToCssVars(image), THEME_PACK_VAR_KEYS);
    expect(root.get('--jj-bg-image')).toBe('url("https://x.test/a.png")');

    applyThemeVars(root.target, themePackToCssVars(solid), THEME_PACK_VAR_KEYS);
    expect(root.get('--jj-bg-image'), '图片地址赖着不走 ⇒ 换包后背景还是上一张图').toBeNull();
  });

  it('换包时主色真的换掉（不是"主色不变"，也不是"变成上一个的"）', () => {
    const root = fakeRoot();
    const light = packOf({
      id: 'a',
      name: 'A',
      version: 1,
      dialog: {},
      background: { kind: 'solid', color: '#141414' },
      primary: '#6ba0ff',
    });
    const dark = packOf({
      id: 'b',
      name: 'B',
      version: 1,
      dialog: {},
      background: { kind: 'solid', color: '#141414' },
      primary: '#8ab4ff',
    });

    applyThemeVars(root.target, themePackToCssVars(light), THEME_PACK_VAR_KEYS);
    expect(root.get('--jj-primary')).toBe('#6ba0ff');
    expect(root.get('--jj-primary-ink')).toBe('#101010');

    applyThemeVars(root.target, themePackToCssVars(dark), THEME_PACK_VAR_KEYS);
    expect(root.get('--jj-primary')).toBe('#8ab4ff');
  });

  it('没有主色的包：主色与字色两个变量都被清掉（而不是留着上一个包的）', () => {
    const root = fakeRoot();
    const withPrimary = packOf({
      id: 'a',
      name: 'A',
      version: 1,
      dialog: {},
      background: { kind: 'solid', color: '#141414' },
      primary: '#6ba0ff',
    });
    const withoutPrimary = packOf({
      id: 'b',
      name: 'B',
      version: 1,
      dialog: {},
      background: { kind: 'solid', color: '#141414' },
    });

    applyThemeVars(root.target, themePackToCssVars(withPrimary), THEME_PACK_VAR_KEYS);
    expect(root.get('--jj-primary')).toBe('#6ba0ff');

    applyThemeVars(root.target, themePackToCssVars(withoutPrimary), THEME_PACK_VAR_KEYS);
    expect(root.get('--jj-primary')).toBeNull();
    expect(root.get('--jj-primary-ink')).toBeNull();
  });

  it('清单之外的变量不动（这个函数只管样式包那批 `--jj-*`）', () => {
    const root = fakeRoot();
    root.put('--unrelated', 'keep-me');
    applyThemeVars(root.target, {}, THEME_PACK_VAR_KEYS);
    expect(root.get('--unrelated')).toBe('keep-me');
  });
});
