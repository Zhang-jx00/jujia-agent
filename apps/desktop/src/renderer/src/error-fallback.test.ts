import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAILURE_DETAIL_MAX_CHARS, failureView } from './error-fallback';

/**
 * 崩掉时给用户看的那张卡（外部审查 T5 的第二半）。
 *
 * 这里能纯测的是"卡上说什么、说多长"；"边界真的挂在路由外面"是**接线锁**那条，
 * 而"真出错时真的显示这张卡"需要渲染层组件测试环境（jsdom + testing-library）——
 * 那是**新增依赖**，要所有者拍板，不由一次缺陷修复顺手做掉（见 review/REVIEW-LOG.md 本轮的覆盖边界）。
 */
describe('failureView', () => {
  it('点名是哪一页坏了：只写"出错了"会让人以为整个应用废了', () => {
    const v = failureView('对话', new Error('boom'));
    expect(v.heading).toContain('对话');
    expect(v.heading).toContain('没能显示出来');
  });

  it('错误原文进 detail（不许只留一句安慰话，否则现场没了指向）', () => {
    const v = failureView('浏览器', new Error('chunk 加载失败'));
    expect(v.detail).toContain('chunk 加载失败');
  });

  it('超长堆栈被截断并说明去哪儿看全量', () => {
    const v = failureView('Git', new Error('x'.repeat(FAILURE_DETAIL_MAX_CHARS + 300)));
    expect(v.detail.length).toBeLessThan(FAILURE_DETAIL_MAX_CHARS + 60);
    expect(v.detail).toContain('开发者控制台');
  });

  it('非 Error 抛出的东西也要能显示（不靠 instanceof 猜成功路径）', () => {
    expect(failureView('钩子', '字符串而已').detail).toBe('字符串而已');
    expect(failureView('钩子', undefined).detail).toBe('undefined');
  });

  it('提示里有"其它页签仍可用"与"重试只重画这一页"两件事', () => {
    const v = failureView('文档', new Error('e'));
    expect(v.hint).toContain('其它页签');
    expect(v.hint).toContain('重试');
  });
});

describe('错误边界真的挂在懒加载外层（接线锁）', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const app = strip(readFileSync(join(here, 'App.tsx'), 'utf8'));

  it('ErrorBoundary 在 Suspense 外面 —— 放里面就接不到 chunk 加载失败', () => {
    const open = app.indexOf('<ErrorBoundary');
    const susp = app.indexOf('<Suspense');
    expect(open).toBeGreaterThan(-1);
    expect(susp).toBeGreaterThan(open);
    expect(app.indexOf('</ErrorBoundary>')).toBeGreaterThan(app.indexOf('</Suspense>'));
  });

  it('以当前页签为 key：换页即重挂，坏页面能自己活回来；area 说的是此刻这一页', () => {
    expect(app).toContain('<ErrorBoundary key={tab} area={TAB_LABEL[tab]}>');
  });

  it('权限审批弹窗仍然在边界之外（弹窗不能被某一页的崩溃一起带走）', () => {
    expect(app.indexOf('<PermissionDialog />')).toBeGreaterThan(app.indexOf('</ErrorBoundary>'));
  });
});
