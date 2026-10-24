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

interface IconProps {
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
