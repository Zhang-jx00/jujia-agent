/**
 * 把样式包的受控变量写到 `:root`（R58 · T79）。
 *
 * ## 为什么单独抽一个函数
 *
 * 写 CSS 变量用的是 `setProperty` —— 它**只写不清**。
 * ⇒ 换包时，上一个包留下的变量会**留在 `:root` 上**。
 *
 * 今天这件事看不出来，是因为 `--jj-primary` 是**惰性**字段（渲染层没人读它），
 * 残留也无所谓。**一接线就变成真的了**：用户从「柔和渐变」切到「默认暗色」，
 * `--jj-primary` 还停在上一个包的值上 ⇒ "换包后主色还是上一个包的" ⇒
 * 于是"换包后主色不变"这个洞被修成"换包后主色变成上一个的"，**一样是坏的**。
 *
 * 同族受害者还有 `--jj-bg-image`（图片背景）—— 从图片包切到纯色包，图片地址会**赖着不走**。
 *
 * ## 两条纪律
 *
 * 1. **先清后写**：把「这次没定义」的那些按已知清单**清掉**，再写这次的。
 * 2. **清单要全**：`knownKeys` 必须覆盖样式包**可能**产出的全部变量 ——
 *    少一个，那个变量就永远清不掉（清单本体在 `@jujia/ui-tokens` 的 `THEME_PACK_VAR_KEYS`，
 *    与产出函数的对齐由单测守着）。
 *
 * ## 为什么这个文件**不 import** `@jujia/ui-tokens` 的任何**值**
 *
 * `App.tsx` 走**动态** import 拉 `@jujia/ui-tokens`（首屏性能：那个包不进首屏 chunk）。
 * 若这里静态 import 它，`App.tsx` 静态 import 本文件 ⇒ **令牌包被拖回首屏 chunk** ⇒ 性能回退。
 * ⇒ 变量表与清单都**由调用方传进来**（调用方自己决定是静态还是动态拿）。
 */

/** 写 CSS 变量需要的那一小块 surface（`document.documentElement` 天然满足） */
export interface ThemeVarTarget {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/**
 * 把样式包的受控变量写到目标元素上。
 *
 * @param root      目标（通常是 `document.documentElement`）
 * @param vars      这次**要写**的变量（`themePackToCssVars` 的产出）
 * @param knownKeys 样式包**可能**产出的全部变量名（用来清残值）
 */
export function applyThemeVars(
  root: ThemeVarTarget,
  vars: Record<string, string>,
  knownKeys: readonly string[],
): void {
  // 先清残值：这次没定义的、但清单里有的 ⇒ 上一个包留下的 ⇒ 搬走
  for (const key of knownKeys) {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      root.style.removeProperty(key);
    }
  }
  // 再写这次的
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
