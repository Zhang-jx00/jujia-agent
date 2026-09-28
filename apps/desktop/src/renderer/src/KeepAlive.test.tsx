// @vitest-environment jsdom
import { useState } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KeepAlive } from './KeepAlive';

/**
 * 页签级"保持挂载"容器（T22 报备 §二/§四，批复七条全同意）。
 *
 * 这三条不是"界面看起来对"，而是这个机制**唯一的立身之本**：
 * ① 首次激活前不挂载 —— 保住懒加载（首屏预算不受影响）；
 * ② 激活过就一直挂着 —— 切走再切回，子组件的本地 state 与**流订阅**都还在（这是 T22 的分水岭）；
 * ③ 非激活时容器带 `hidden` —— 看不见但也**没被卸载**。
 * 三条各有一次变异（M56/M57/M58 思路同源），缺任何一条这个机制就退化成"看起来像保住了"。
 */

/** 带本地 state 的探针：它的计数就是"有没有被卸载过"的硬证据 */
function Probe(): ReactElement {
  const [n, setN] = useState(0);
  return (
    <button type="button" data-testid="probe" onClick={() => setN((v) => v + 1)}>
      {String(n)}
    </button>
  );
}

const probe = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-testid="probe"]');
/** `KeepAlive` 只渲染**一个**包装元素，所以第一个子元素就是它（不给生产代码塞测试专用属性） */
const shell = (root: HTMLElement): HTMLElement | null => root.firstElementChild as HTMLElement | null;

describe('KeepAlive：激活过就再也不卸载，没激活过连挂都不挂', () => {
  it('首次激活前什么都不渲染（懒加载性质没丢）', () => {
    const { container } = render(
      <KeepAlive active={false}>
        <Probe />
      </KeepAlive>,
    );
    expect(probe(container)).toBeNull();
    cleanup();
  });

  it('激活 → 切走 → 再切回：子组件的 state 原样还在（没被卸载过）', () => {
    const { container, rerender } = render(
      <KeepAlive active>
        <Probe />
      </KeepAlive>,
    );
    const before = probe(container);
    expect(before).not.toBeNull();
    fireEvent.click(before as HTMLElement); // 计数 0 → 1
    expect(probe(container)?.textContent).toBe('1');

    rerender(
      <KeepAlive active={false}>
        <Probe />
      </KeepAlive>,
    );
    // 切走之后：还在 DOM 里，只是被藏起来；计数仍是 1（说明没重挂）
    expect(probe(container)).not.toBeNull();
    expect(probe(container)?.textContent).toBe('1');

    rerender(
      <KeepAlive active>
        <Probe />
      </KeepAlive>,
    );
    expect(probe(container)?.textContent).toBe('1');
    cleanup();
  });

  it('非激活时容器带 hidden，切回即摘掉', () => {
    const { container, rerender } = render(
      <KeepAlive active>
        <Probe />
      </KeepAlive>,
    );
    expect(shell(container)?.hidden).toBe(false);

    rerender(
      <KeepAlive active={false}>
        <Probe />
      </KeepAlive>,
    );
    expect(shell(container)?.hidden).toBe(true);

    rerender(
      <KeepAlive active>
        <Probe />
      </KeepAlive>,
    );
    expect(shell(container)?.hidden).toBe(false);
    cleanup();
  });
});
