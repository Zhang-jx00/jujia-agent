// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LUCIDE_NOTICE } from '../../ui/icons';
import { NoticesCard } from './NoticesCard';

/**
 * 第三方素材声明的**渲染层**接线锁（R70 · 排查39）。
 *
 * 为什么立它：ISC 要求版权声明「**随副本保留**」。原状是——
 * 声明写成源码里的一个常量、**没有任何被分发的代码引用它** ⇒ 打包时被树摇掉
 * ⇒ 分发副本里一个字都没有（实测构建产物 0 命中）。
 * ⇒ 所以这里钉两件事，缺一不可：
 *
 *   ① **这张卡把声明渲染出来了**（逐字，不截断、不改写）；
 *   ② **概览页真的挂着这张卡**（导出 ≠ 画出来 —— R69 的 M350 同款坑：
 *      卡写好了却忘了挂上去，声明照样进不了分发副本，而**没有任何门禁会红**）。
 */

/**
 * **不能用 `new URL('../../App.tsx', import.meta.url)`** —— jsdom 环境的 `URL`（whatwg-url）
 * 不支持拿 `file:` 当基址做相对解析 ⇒ 解析出来的东西不是 file: 协议 ⇒ `fileURLToPath` 直接报
 * 「The URL must be of scheme file」。⇒ 改成"先转成目录，再 join"（与 `ui/icons.test.tsx` 同一写法）。
 */
const here = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(here, '..', '..', 'App.tsx'), 'utf8');
/** 剥掉注释再判 —— 否则注释里写一句 `<NoticesCard />` 就能把这条锁喂饱（R54 的教训） */
const appSrcNoComments = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  cleanup();
});

describe('第三方素材与许可卡', () => {
  it('把版权声明**逐字**渲染出来（截断或改写都不算保留）', () => {
    const { container } = render(<NoticesCard />);
    const text = container.textContent ?? '';
    expect(text, '声明一个字都没渲染出来 ⇒ 这张卡是空壳').toContain(LUCIDE_NOTICE);
    expect(text).toContain('ISC');
  });

  it('概览页**真的挂着**这张卡（导出了不等于画出来了）', () => {
    expect(appSrcNoComments, 'App.tsx 没有 import 这张卡').toMatch(/import\s*\{[^}]*NoticesCard[^}]*\}\s*from/);
    expect(appSrcNoComments, 'App.tsx 里没有渲染这张卡 ⇒ 声明进不了分发副本').toContain('<NoticesCard');
  });
});
