import { describe, expect, it } from 'vitest';
import { PDF_MAX_BYTES, PDF_MAX_PAGES } from './limits';
import { checkPdfPages, checkPdfSize } from './pdf-limits';

/**
 * PDF 两条上限的**行为级**判定（复核 041 第二条建议：把"只有接线锁"的覆盖边界减到一处）。
 *
 * 边界值直接喂纯函数即可 —— 不必真造一份 32MB 的 PDF，也不必造 2000 页的。
 * 每条断言的意义都在"恰好卡在边界上"：等于上限要放行（不能少 1 字节就拒），
 * 上限 +1 必须拒（不能多 1 字节也放）。
 */

describe('checkPdfSize：恰好等于上限放行，超过就拒', () => {
  it('小于 / 等于上限都放行', () => {
    expect(checkPdfSize(0)).toBeNull();
    expect(checkPdfSize(PDF_MAX_BYTES - 1)).toBeNull();
    expect(checkPdfSize(PDF_MAX_BYTES)).toBeNull();
  });

  it('上限 +1 就拒，且理由里写清两个数（用户要知道差多少）', () => {
    const why = checkPdfSize(PDF_MAX_BYTES + 1);
    expect(why).not.toBeNull();
    expect(why).toContain('32 MB');
    expect(why).toContain('超过');
  });

  it('读不出来的大小（负 / NaN / Infinity）也当拒绝，不许"看着像 0 就放行"', () => {
    expect(checkPdfSize(-1)).not.toBeNull();
    expect(checkPdfSize(Number.NaN)).not.toBeNull();
    expect(checkPdfSize(Number.POSITIVE_INFINITY)).not.toBeNull();
  });
});

describe('checkPdfPages：恰好等于上限放行，超过就拒', () => {
  it('1 页与等于上限都放行', () => {
    expect(checkPdfPages(1)).toBeNull();
    expect(checkPdfPages(PDF_MAX_PAGES)).toBeNull();
  });

  it('上限 +1 拒绝，理由里有页数', () => {
    const why = checkPdfPages(PDF_MAX_PAGES + 1);
    expect(why).not.toBeNull();
    expect(why).toContain(String(PDF_MAX_PAGES + 1));
  });

  it('0 页 / 非整数也当拒绝（解析出怪值就停，不拿它去渲染）', () => {
    expect(checkPdfPages(0)).not.toBeNull();
    expect(checkPdfPages(1.5)).not.toBeNull();
  });
});
