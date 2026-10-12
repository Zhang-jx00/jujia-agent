// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconFolder,
  IconLoaderCircle,
  IconPencil,
  IconRotateCw,
  IconTriangleAlert,
  IconX,
  LUCIDE_NOTICE,
} from './icons';

/**
 * 图标系统的接线锁（R19 · 优化6）。
 *
 * 两件事都要机械化，不然"换了一处、漏了一处"永远靠肉眼：
 * ① 每个图标都渲染成 `aria-hidden` 的 `svg[data-icon]`（装饰性图标的统一契约）；
 * ② **全仓渲染层不许再出现字符图标与 emoji**（📁 📄 ⟳ ✎ ⚠ ◌ ✓ ✗ ⌄）——
 *    这条是"扫现状"而不是"扫一行"，新写的组件同样受管。
 */

const here = dirname(fileURLToPath(import.meta.url));

/** 递归收集渲染层的 .tsx 源码（测试之外） */
function collectTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === 'node_modules') continue;
      collectTsx(full, out);
    } else if (name.name.endsWith('.tsx') && !name.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

afterEach(() => {
  cleanup();
});

describe('图标契约', () => {
  it('每个图标都渲染成 aria-hidden 的 svg[data-icon]（装饰性图标的统一形状）', () => {
    const icons = [
      IconCheck,
      IconX,
      IconTriangleAlert,
      IconRotateCw,
      IconPencil,
      IconFolder,
      IconFileText,
      IconLoaderCircle,
      IconChevronDown,
    ];
    for (const Icon of icons) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg, `${Icon.name} 没有渲染出 svg`).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.hasAttribute('data-icon')).toBe(true);
      expect(svg?.getAttribute('stroke')).toBe('currentColor'); // 颜色随文字走
      unmount();
    }
  });

  it('许可声明在模块里（ISC 要求随副本保留）', () => {
    expect(LUCIDE_NOTICE).toContain('Lucide');
    expect(LUCIDE_NOTICE).toContain('ISC');
  });
});

describe('全仓清扫：字符图标与 emoji 不许回来', () => {
  it('渲染层 .tsx 里没有 📁 📄 ⟳ ✎ ⚠ ◌ ✓ ✗ ⌄（图标一律走 ui/icons）', () => {
    const forbidden = ['📁', '📄', '⟳', '✎', '⚠', '◌', '✓', '✗', '⌄', '›'];
    const offenders: string[] = [];
    for (const file of collectTsx(here)) {
      if (file.endsWith(join('ui', 'icons.tsx'))) continue; // 图标模块自己不含这些字符，跳过只为明确
      const src = readFileSync(file, 'utf8');
      for (const glyph of forbidden) {
        if (src.includes(glyph)) offenders.push(`${file.replace(here, '.')} 含 ${glyph}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
