import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 动效与微交互的接线锁（R18 · 优化5）。
 *
 * 判据是 `docs/DESIGN-BASELINE.md` 里那三条硬要求 —— 这里把它们译成"扫源码也拦得住"的形状：
 * ① 展开用**真实内容高度**的轨道过渡，不许退回 `max-height` 猜数；
 * ② 箭头**同一个元素旋转 180°**，不许"换一个字符"；
 * ③ 内容**始终挂载**（收起靠 inert/aria-hidden），不许从 DOM 里摘掉再插回来（= 文字突然出现）。
 * 另外钉住"按压反馈覆盖主要可点家族"与"降级仍在"。
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), 'utf8');

const motion = read('styles/motion.css');
const card = read('features/chat/ToolCard.tsx');

describe('展开/收起按设计基线做（R18）', () => {
  it('容器用真实内容高度的轨道过渡，不是猜一个 max-height', () => {
    expect(motion).toContain('.jj-collapse');
    expect(motion).toContain('transition: grid-template-rows');
    expect(motion).toContain('grid-template-rows: 0fr');
    // 反向锁：collapse 相关的规则里不许出现 max-height（那是"看起来对了"的近似）
    expect(/\.jj-collapse[^{]*\{[^}]*max-height/s.test(motion)).toBe(false);
    expect(card).not.toContain('maxHeight');
  });

  it('箭头同一个元素旋转 180°（不换字符）', () => {
    expect(/\.jj-caret\[data-open='true'\]\s*\{[^}]*rotate\(180deg\)/s.test(motion)).toBe(true);
    expect(card).toContain('data-caret');
    // 旧写法是"两个字符切换"，本轮不许回来
    expect(card).not.toContain("? '›' : '⌄'");
    expect(card).not.toContain('jj-tool-caret');
  });

  it('内容始终挂载：收起态用 inert + aria-hidden 退出可达性树', () => {
    expect(card).toContain('jj-collapse');
    expect(card).toContain('inert');
    expect(card).toContain("'aria-hidden'");
    // 反向锁：L1 不许退回"条件挂载"（那正是文字突然出现的形状）
    expect(card).not.toContain("level !== 'L0' && (");
  });

  it('按压反馈覆盖主要可点家族（100ms 轻微缩放）', () => {
    for (const sel of ['.app-tab', 'button.jj-btn', 'button.w2-btn', 'button.w2-btn-primary', '.jj-tool-l0']) {
      expect(motion, `按压规则应当覆盖 ${sel}`).toContain(sel);
    }
    expect(motion).toContain('scale(0.97)');
    expect(motion).toContain('--motion-duration-instant');
  });

  it('过场时长只用动效令牌，不写裸毫秒（令牌层之外的裸数就是下一处漂移）', () => {
    const collapseBlock = /\.jj-collapse \{[\s\S]*?\}/.exec(motion)?.[0] ?? '';
    expect(collapseBlock).toContain('var(--motion-duration-fast)');
    expect(/\b\d+ms\b/.test(collapseBlock)).toBe(false);
  });

  it('无障碍降级仍在（prefers-reduced-motion 全局压时长）', () => {
    expect(motion).toContain('prefers-reduced-motion');
  });
});
