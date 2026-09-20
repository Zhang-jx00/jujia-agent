/**
 * 设计令牌（W6）：颜色 / 间距 / 字号 / 圆角 / 阴影 / **动效**。
 *
 * 纪律：**渲染层不允许出现硬编码颜色与时长**，一律走这里的令牌。
 * 动效数值来自 2026-09-20 联网核实的最佳实践（见 knowledge/cards/014）：
 * - 微交互（反馈）100–200ms；状态过渡 200–500ms；**功能动效不得超过 1s**
 * - 入场用 ease-out、离场用 ease-in、屏内移动用 ease-in-out；linear 仅用于持续型动效
 * - 只动 `transform` 与 `opacity`（合成器线程），不动 width/height/top/left 等触发布局的属性
 */

/** 深色主题（默认）。亮色主题的覆盖值见 renderer 的 tokens.css。 */
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
} as const;

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
  pill: '999px',
} as const;

export const shadow = {
  none: 'none',
  card: '0 1px 2px rgba(0, 0, 0, 0.24)',
  popover: '0 6px 20px rgba(0, 0, 0, 0.36)',
  dialog: '0 12px 40px rgba(0, 0, 0, 0.5)',
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
} as const;

/** 从 tokens 生成 CSS 自定义属性（供 renderer 在运行时注入） */
export function toCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(color)) vars[`--c-${kebab(k)}`] = v;
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
