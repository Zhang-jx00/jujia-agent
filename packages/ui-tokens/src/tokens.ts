/**
 * 设计令牌（W6）：颜色 / 间距 / 字号 / 圆角 / 阴影 / **动效**。
 *
 * 纪律：**渲染层不允许出现硬编码颜色与时长**，一律走这里的令牌。
 * 动效数值来自 2026-09-20 联网核实的最佳实践（见 knowledge/cards/014）：
 * - 微交互（反馈）100–200ms；状态过渡 200–500ms；**功能动效不得超过 1s**
 * - 入场用 ease-out、离场用 ease-in、屏内移动用 ease-in-out；linear 仅用于持续型动效
 * - 只动 `transform` 与 `opacity`（合成器线程），不动 width/height/top/left 等触发布局的属性
 */

/** 深色主题（默认）。亮色主题见 `lightColor`（**同名同族 ⇒ 双主题可互换**）。 */
export const color = {
  bgLayout: '#141414',
  bgContainer: '#1f1f1f',
  bgElevated: '#252525',
  bgInput: '#101010',
  text: '#f5f5f5',
  textSecondary: '#a6a6a6',
  /** 语义色。**注意：对比度已按 WCAG AA 校验过**（见 UX-AUDIT） */
  primary: '#4c8dff',
  primaryHover: '#6ba0ff',
  success: '#5ec97a',
  warning: '#e0a52e',
  danger: '#ff7875',
  border: 'rgba(255, 255, 255, 0.14)',
  borderStrong: 'rgba(255, 255, 255, 0.28)',
  /** 遮罩：权限弹窗等 */
  scrim: 'rgba(0, 0, 0, 0.55)',

  /* ---- R77（M1 令牌层）新增语义档：新壳要用，且**亮暗同名** ---- */
  /** 表面层级：新壳的三栏各占一层（底 / 面板 / 浮层） */
  surface1: '#1a1b1f',
  surface2: '#232429',
  surface3: '#2c2d33',
  /** 文字第三/第四阶（**对比度经机器锁复算，以最差表面 surface3 为准**：暗色 4.51:1 / 亮色 4.55:1） */
  textTertiary: '#9093a5',
  textDisabled: '#727584',
  /** 焦点环（键盘可达性） */
  focus: '#5b93ff',
  /** 主色淡底（选中态） */
  primarySubtle: 'rgba(91, 147, 255, 0.14)',
  /**
   * **文字安全的主色**（R77 · M1 新增）。
   *
   * 为什么要有这一支：`.jj-log-scope` 这类**把主色当文字色用**的位置，需要的是
   * "在浅底上也过 AA"的那一档 —— 暗色下恰好是 `--c-primary-hover`（更浅），
   * 亮色下却是反的（更浅 ⇒ 在浅底上更看不清）⇒ **同一个 hover 令牌在两个主题里语义相反**。
   * ⇒ 单开一支：`--c-primary-strong` = "主色作文字用"的那一档（暗色 #6ba0ff / 亮色 #3369cd），
   * 两者都经机器锁按**最差表面**复算 AA（见 `tokens-theme-parity.test.ts`）。
   */
  primaryStrong: '#6ba0ff',
} as const;

/**
 * 亮色主题（**与 `color` 同名同族**）。
 *
 * 为什么单独一份而不是运行时反转：反转会得到"脏"的中间色 ⇒ 对比度不可控；
 * 显式两份 ⇒ 每个令牌值都能单独按 WCAG 复算（机器锁盯的就是这一条）。
 *
 * 取值与原型的双主题令牌一致（`ui-redesign-proto/src/tokens/theme.css`），
 * 数字口径统一走 `contrastRatio` 复算 ⇒ 两处不漂。
 */
export const lightColor = {
  bgLayout: '#f7f7f8',
  bgContainer: '#ffffff',
  bgElevated: '#ffffff',
  bgInput: '#f1f1f3',
  text: '#17181c',
  textSecondary: '#5b5e6b',
  primary: '#3d7ef7',
  primaryHover: '#2f6fe8',
  success: '#17966a',
  warning: '#b97d10',
  danger: '#d5455c',
  border: '#e3e4e9',
  borderStrong: '#c9cbd4',
  scrim: 'rgba(0, 0, 0, 0.45)',

  surface1: '#ffffff',
  surface2: '#f1f1f3',
  surface3: '#e8e8ec',
  textTertiary: '#656872',
  textDisabled: '#82848c',
  focus: '#3d7ef7',
  primarySubtle: 'rgba(61, 126, 247, 0.1)',
  /** 文字安全的主色（亮色下必须更深才过 AA —— 见 `color.primaryStrong` 的说明） */
  primaryStrong: '#3369cd',
} as const;

/** 主题名（M1：双主题是**令牌层的事实**，接线到界面属 M3 壳的活） */
export type ThemeName = 'dark' | 'light';

/**
 * 调色板的形状：键与 `color` 完全一致，值是字符串。
 * **为什么不锁字面量类型**：`typeof color` 会把每个值锁成字面量（`"#141414"`）⇒ 亮色那份
 * 永远赋不进去（TS2322）⇒ 值必须放宽成 `string`，而**"键集合相同"这件事由机器锁盯**
 * （`tokens-theme-parity.test.ts`），类型层不重复承担同一件事。
 */
export type Palette = Record<keyof typeof color, string>;

export const themes: Record<ThemeName, Palette> = {
  dark: color,
  light: lightColor,
};

/** 4px 基准间距阶梯 */
export const space = {
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
} as const;

export const fontSize = {
  caption: '11px',
  small: '12px',
  body: '13px',
  base: '14px',
  title: '15px',
  heading: '18px',
} as const;

export const radius = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  /** R77（M1）新增：更大两档 —— 新壳的卡片与弹层要用 */
  xl: '12px',
  '2xl': '16px',
  pill: '999px',
} as const;

export const shadow = {
  none: 'none',
  card: '0 1px 2px rgba(0, 0, 0, 0.24)',
  popover: '0 6px 20px rgba(0, 0, 0, 0.36)',
  dialog: '0 12px 40px rgba(0, 0, 0, 0.5)',
  /** R77（M1）新增：**按层级的浮层阴影**（新壳的进程卡/对话框用） */
  elev1: '0 1px 2px rgba(0, 0, 0, 0.40)',
  elev2: '0 4px 14px rgba(0, 0, 0, 0.46)',
  elev3: '0 14px 40px rgba(0, 0, 0, 0.55)',
} as const;

/**
 * 动效令牌。
 * 取值刻意保守：宁可"快而稳"，也不要"慢而精致"——超过 300ms 的功能动效会被读成卡顿。
 */
export const motion = {
  /** 微交互：按钮按压、hover 反馈 */
  durationInstant: '100ms',
  /** 常规状态过渡：展开、淡入 */
  durationFast: '160ms',
  /** 较大面板：卡片扩展、抽屉入场 */
  durationNormal: '240ms',
  /** 上限：仅用于大范围布局变化；**功能动效不得超过 1s** */
  durationSlow: '320ms',

  /** 入场：快起慢停 */
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** 离场：慢起快出 */
  easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
  /** 屏内移动 */
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  /** 仅用于持续型动效（进度条/加载指示） */
  easeLinear: 'linear',

  /** 列表错峰：同屏同时动画的元素不超过 2–3 个 */
  staggerStep: '40ms',

  /* ---- R77（M1）新增：通用曲线（Apple 式快起慢停 / Material 式强调） ---- */
  /** 通用：面板展开、路由切换 */
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  /** 强调：需要"被看见"的转场（对话框、抽屉） */
  easeEmphasized: 'cubic-bezier(0.3, 0, 0.2, 1)',
} as const;

/**
 * 从 tokens 生成 CSS 自定义属性（供 renderer 在运行时注入）。
 * @param theme 主题名（M1 起有亮/暗两份；缺省暗色）
 */
export function toCssVars(theme: ThemeName = 'dark'): Record<string, string> {
  const palette: Palette = themes[theme];
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) vars[`--c-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(space)) vars[`--space-${k}`] = v;
  for (const [k, v] of Object.entries(fontSize)) vars[`--fs-${k}`] = v;
  for (const [k, v] of Object.entries(radius)) vars[`--radius-${k}`] = v;
  for (const [k, v] of Object.entries(shadow)) vars[`--shadow-${k}`] = v;
  for (const [k, v] of Object.entries(motion)) vars[`--motion-${kebab(k)}`] = v;
  return vars;
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export const tokens = { color, space, fontSize, radius, shadow, motion } as const;
