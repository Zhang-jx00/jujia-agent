import type { ReactElement, ReactNode } from 'react';

/**
 * 内联图标（R19 · 优化6）。
 *
 * 三条纪律：
 * 1. **零运行时依赖** —— 路径数据直接内联，不引 npm 包（要引的话属停牌②，得先问所有者）；
 * 2. **来源与许可**：全部取自 Lucide（https://lucide.dev），**ISC 许可**，
 *    版权声明见下方 `LUCIDE_NOTICE`（ISC 要求随副本保留）；
 * 3. **贴合主题**：只挑这套界面真正用得上的（状态 / 折叠 / 刷新 / 编辑 / 目录与文件），
 *    统一 24×24 视框、`stroke="currentColor"`、线宽 2 —— 颜色随文字走，不另定色。
 *
 * 无障碍约定：图标是**装饰**（旁边永远有文字或所在按钮自带 aria-label），
 * 所以默认 `aria-hidden`；需要独立表达含义时由调用方给容器加 `aria-label`/`sr-only` 文本。
 */

/** Lucide 的 ISC 版权声明（微缩保留：出处 + 许可 + 版权行） */
export const LUCIDE_NOTICE =
  'Icons from Lucide (https://lucide.dev), ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT), and other contributors.';

export interface IconProps {
  /** 边长（px）；默认 14 —— 与 13/14px 正文同高，不抢视线 */
  size?: number;
  /** 额外类名（默认已有 `jj-icon`） */
  className?: string;
}

interface GlyphProps extends IconProps {
  children: ReactNode;
}

function Glyph({ children, size = 14, className }: GlyphProps): ReactElement {
  return (
    <svg
      className={className === undefined ? 'jj-icon' : `jj-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon=""
    >
      {children}
    </svg>
  );
}

export function IconCheck(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  );
}

export function IconX(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  );
}

export function IconTriangleAlert(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}

export function IconRotateCw(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Glyph>
  );
}

export function IconPencil(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </Glyph>
  );
}

export function IconFolder(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Glyph>
  );
}

export function IconFileText(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Glyph>
  );
}

export function IconLoaderCircle(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Glyph>
  );
}

export function IconChevronDown(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

/**
 * 放大镜（R67 · 设置中心的搜索框）。
 *
 * 取自 Lucide 的 `search`（圆 + 斜柄）—— 与本模块其余图标同源、同许可、同形状约定。
 */
export function IconSearch(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Glyph>
  );
}

/**
 * 齿轮（R67 · 设置中心入口）。
 *
 * 取自 Lucide 的 `settings`（齿轮 + 中心圆）—— 与本模块其余图标同源、同许可、同形状约定。
 * 为什么加它：设置入口在左栏底部，**一个齿轮比一行文字更像"入口"**（同类桌面工具都这么做）。
 */
export function IconGear(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  );
}

/*
 * ============================================================================
 * 左栏入口图标（R69 · 左栏图标化）
 * ============================================================================
 *
 * 为什么加这一组：R68 之后左栏只剩 **7 个文字入口** ⇒ 一眼扫过去**认不出哪个是哪一页**
 * （"文件"和"文档"、"Git"和"画布"都只是两个字）⇒ 补图标。
 *
 * **路径数据从 Lucide 1.61.0 的实际 SVG 里抄**（`lucide-static@1.61.0/icons/<name>.svg`，
 * 逐个核对过），**不是凭记忆写的** —— 本模块声明"全部取自 Lucide"，凭记忆写会让那句声明变成假的。
 *
 * 为什么零新依赖：路径数据直接内联（同本模块既有做法）⇒ **不引 npm 包**
 * （引包属停牌②，得先问所有者）。
 */

/**
 * 概览（四格仪表盘，Lucide 的 `layout-dashboard`）。
 *
 * 为什么用它而不是"房子"：本仓的概览页是**运行时 / 配置 / 日志 / 更新**那种**仪表盘**，
 * 不是"首页门户" ⇒ 四格比房子更贴。
 */
export function IconLayoutDashboard(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </Glyph>
  );
}

/** 对话（Lucide 的 `message-square` —— 折角的气泡）。 */
export function IconMessageSquare(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
    </Glyph>
  );
}

/** Git（Lucide 的 `git-branch` —— 一个分叉的提交图）。 */
export function IconGitBranch(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M15 6a9 9 0 0 0-9 9V3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
    </Glyph>
  );
}

/** 画布（Lucide 的 `workflow` —— 两个节点接一条线）。 */
export function IconWorkflow(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </Glyph>
  );
}

/** 终端（Lucide 的 `terminal` —— 尖括号 + 一条横线）。 */
export function IconTerminal(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M12 19h8" />
      <path d="m4 17 6-6-6-6" />
    </Glyph>
  );
}

/** 连接（Lucide 的 `plug` —— 插头）。 */
export function IconPlug(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <path d="M12 22v-5" />
      <path d="M15 8V2" />
      <path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" />
      <path d="M9 8V2" />
    </Glyph>
  );
}

/** 浏览器（Lucide 的 `globe` —— 地球）。 */
export function IconGlobe(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </Glyph>
  );
}

/** 绘图（Lucide 的 `image` —— 相框 + 小圆 + 山）。 */
export function IconImage(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Glyph>
  );
}

/** 定时（Lucide 的 `clock` —— 表盘 + 时针分针）。 */
export function IconClock(props: IconProps): ReactElement {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Glyph>
  );
}

/**
 * **图标名 → 实现**的单查表（R69 · 左栏图标化）。
 *
 * 为什么要有这张表：导航真源 `nav.ts` **只认图标名（字符串）**，不认组件 ——
 * 理由：`nav.ts` 是**纯数据模块**（主进程那条接线锁把它当**文本**读），
 * 让它 import React 组件会把纯数据变成 UI 模块。
 * ⇒ 于是「入口 → 图标名」在 `nav.ts`，「图标名 → 组件」在这里，**两张表各管一段、没有重复**。
 *
 * 为什么这张表**必须齐全**：少一个名字 ⇒ 那一枚图标**渲染不出来**（界面上少一个图标）。
 * ⇒ 判据盯着它（见 `nav-wiring.test.ts` 的「图标名 ↔ 实现」那几条）。
 */
export const ICON_BY_NAME: Record<string, (props: IconProps) => ReactElement> = {
  check: IconCheck,
  x: IconX,
  'triangle-alert': IconTriangleAlert,
  'rotate-cw': IconRotateCw,
  pencil: IconPencil,
  folder: IconFolder,
  'file-text': IconFileText,
  'loader-circle': IconLoaderCircle,
  'chevron-down': IconChevronDown,
  search: IconSearch,
  gear: IconGear,
  'layout-dashboard': IconLayoutDashboard,
  'message-square': IconMessageSquare,
  'git-branch': IconGitBranch,
  workflow: IconWorkflow,
  terminal: IconTerminal,
  plug: IconPlug,
  globe: IconGlobe,
  image: IconImage,
  clock: IconClock,
};
