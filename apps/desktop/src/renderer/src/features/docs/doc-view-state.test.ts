import { beforeEach, describe, expect, it } from 'vitest';
import { clearDocView, currentDocView, rememberDocView } from './doc-view-state';

/**
 * T24：文档页记住"上次打开的是哪个文件、看到第几段、滚到哪"。
 *
 * 为什么单独成一个模块（而不是把三个 useState 提到 DocPanel 外面就完事）：
 * ① 页签切走即卸载（`App.tsx` 只对对话页用了 KeepAlive），组件里的 state 必然没了 ——
 *    能活过卸载的只有模块级容器；
 * ② 合并 / 夹紧 / "没有路径就没什么可恢复"这几条规则是有语义的，
 *    写纯了才测得动，也才不会在 DocPanel 里被顺手改坏；
 * ③ **只放内存**：这是"这次运行内别让我重填路径"，不是"把阅读位置写进配置文件"
 *    （T22 报备 §五 明确不做后者，本轮沿用）。
 */

beforeEach(() => {
  clearDocView();
});

describe('currentDocView', () => {
  it('什么都没记过时返回 null（面板不该凭空恢复出一个路径）', () => {
    expect(currentDocView()).toBeNull();
  });

  it('只记过滚动位置、没有路径 → 仍然没什么可恢复', () => {
    rememberDocView({ scrollTop: 120 });
    expect(currentDocView()).toBeNull();
  });
});

describe('rememberDocView', () => {
  it('记下路径后能读回来，缺省字段给可用的初值', () => {
    rememberDocView({ path: 'docs/A.md' });
    const s = currentDocView();
    expect(s).not.toBeNull();
    expect(s?.path).toBe('docs/A.md');
    expect(s?.shown).toBe(0);
    expect(s?.scrollTop).toBe(0);
  });

  it('分段补丁是**合并**而不是覆盖（只报滚动位置不该把路径抹掉）', () => {
    rememberDocView({ path: 'docs/A.md', shown: 240 });
    rememberDocView({ scrollTop: 500 });
    expect(currentDocView()).toEqual({ path: 'docs/A.md', shown: 240, scrollTop: 500 });
  });

  it('换成另一个文件时旧的分段进度不带走（否则新文件会一上来就"继续加载"到看不见的地方）', () => {
    rememberDocView({ path: 'docs/A.md', shown: 480, scrollTop: 900 });
    rememberDocView({ path: 'docs/B.md' });
    expect(currentDocView()).toEqual({ path: 'docs/B.md', shown: 0, scrollTop: 0 });
  });

  it('负数与 NaN 一律收敛到 0（恢复出的滚动位置不能是未定义值）', () => {
    rememberDocView({ path: 'docs/A.md', shown: -3, scrollTop: Number.NaN });
    const s = currentDocView();
    expect(s?.shown).toBe(0);
    expect(s?.scrollTop).toBe(0);
  });

  it('同一路径重记一次不重置进度（切走再切回不该回到开头）', () => {
    rememberDocView({ path: 'docs/A.md', shown: 480, scrollTop: 900 });
    rememberDocView({ path: 'docs/A.md' });
    expect(currentDocView()).toEqual({ path: 'docs/A.md', shown: 480, scrollTop: 900 });
  });

  it('空路径等于"没什么可恢复"', () => {
    rememberDocView({ path: 'docs/A.md' });
    rememberDocView({ path: '' });
    expect(currentDocView()).toBeNull();
  });
});

describe('clearDocView', () => {
  it('清掉之后回到初始态（读文件失败时必须走这条：下次挂载不再反复撞同一个坏路径）', () => {
    rememberDocView({ path: 'gone.md' });
    clearDocView();
    expect(currentDocView()).toBeNull();
  });

  it('返回的对象是副本，改它不会污染store（面板拿到的是快照）', () => {
    rememberDocView({ path: 'docs/A.md' });
    const s = currentDocView();
    if (s === null) throw new Error('恢复态不该为空');
    s.path = 'tampered.md';
    expect(currentDocView()?.path).toBe('docs/A.md');
  });
});
