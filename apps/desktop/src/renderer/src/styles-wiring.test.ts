import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **样式接线锁（CSS 版）**（复核 049 的新要求：把"靠 grep + 人眼"变成机器）。
 *
 * 为什么立它：B1 那一轮 `styles.css` 差点整份漏提交 —— 它一直在工作树里、门禁跑的就是含它的树，
 * 只是 `git add` 清单漏了这个路径（自查补装救回）。而样式缺失**门禁全都不咬**：e2e 断的是 DOM 与坐标，
 * 组件测试断的是文本，谁也看不见"这个 class 在样式表里根本没有规则"。
 *
 * 这个锁的问法很朴素：**渲染层源码里在 className 上引用的类名，必须在渲染层的样式表里有规则**。
 * - 范围 = 本仓自研 UI 的六个前缀（jj / p0 / w2 / w3 / w5 / app）；第三方类名（react-flow__ 等）不在此列；
 * - 样式表 = `renderer/src` 下的**全部** `.css`（`styles.css` + `styles/motion.css` —— 后者住着动效类）；
 * - 只看 `className=` 后面真正那段值（字符串 / 模板 / 花括号表达式）—— `id` / `htmlFor` 里的东西不算类名；
 * - 动态拼接（`jj-canvas-node-${status}`）按**前缀段**检查：能拦"整块样式没进样式表"（本轮的形状），
 *   拦不住"某一个变体漏了"（如实登记为边界）。
 *
 * 两条防失焦断言（同 WORK-PROTOCOL 第 31 条的精神）：① 扫到的类名总数有下限 —— 扫描路径写坏时
 * 会先在数量上红，而不是空转通过；② 样式表合计长度有下限。
 */

/** className= 那段值的边界（`"` 直取；`{` 花括号配平，跳过单双引号字符串与模板串） */
function endOfClassNameValue(text: string, start: number): number {
  if (text[start] === '"') return text.indexOf('"', start + 1);
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i += 1;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
    } else if (ch === '`') {
      i += 1;
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '$' && text[i + 1] === '{') depth += 1;
        else if (text[i] === '}' && depth > 0) depth -= 1;
        i += 1;
      }
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return text.length - 1;
}

/** 只取 className 属性上的类名（id / htmlFor / aria 里的 jj- 前缀不算 —— 那类「命名空间复用」不是类） */
function classNamesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/className\s*=\s*/g)) {
    const start = m.index + m[0].length;
    const end = endOfClassNameValue(text, start);
    const region = text.slice(start, end + 1);
    for (const t of region.matchAll(/\b(?:jj|p0|w2|w3|w5|app)-[a-z0-9-]*\b/g)) out.add(t[0]);
  }
  return out;
}

function collect(globDir: string): { sources: string[]; css: string } {
  const sources: string[] = [];
  const cssParts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full);
      else if (/\.css$/.test(e.name)) cssParts.push(readFileSync(full, 'utf8'));
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) sources.push(readFileSync(full, 'utf8'));
    }
  };
  walk(globDir);
  return { sources, css: cssParts.join('\n') };
}

describe('样式接线锁：className 上引用的类名必须在渲染层样式表里有规则', () => {
  const { sources, css } = collect(fileURLToPath(new URL('.', import.meta.url)));
  const tokens = new Set<string>();
  for (const text of sources) {
    for (const t of classNamesIn(text)) tokens.add(t);
  }

  it('先有下限：扫到的类名数量不能塌（扫描路径写坏时先在这里红，而不是空转通过）', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(tokens.size).toBeGreaterThan(40);
    expect(css.length).toBeGreaterThan(1000);
  });

  it('每一个被引用的类名/前缀段都能在样式表里找到', () => {
    /**
     * 判定分两种（校准实验教出来的，2026-10-07）：
     * - 动态前缀段（以 `-` 结尾，如 `jj-canvas-node-`）：是更长名字的一部分也算 —— 子串即可；
     * - 完整类名：必须**整词**命中（左边不是类名字符、右边也不是）——
     *   否则把 `.jj-align-line` 改名成 `.jj-align-line-calib`（这正是校准时的改名）会被子串放行。
     */
    const hasRule = (t: string): boolean => {
      if (t.endsWith('-')) return css.includes(t);
      return new RegExp(`(^|[^a-z0-9-])${t}(?![a-z0-9-])`).test(css);
    };
    const missing = [...tokens].filter((t) => !hasRule(t)).sort();
    expect(missing).toEqual([]);
  });

  it('受属性门控的样式，必须真的有元素带那个类（R20：背景类型曾经静默不生效）', () => {
    /**
     * 形状：`html[data-jj-bg-kind='gradient'] .app-shell { … }` —— 属性出对了、
     * 规则也在样式表里，**但没有任何元素叫 `.app-shell`**（根容器叫 `.app-root`）
     * ⇒ 主题包的"渐变/图片/玻璃"三个选项谁都选不动画面，且所有门禁都是绿的。
     * 这条锁把"属性门控 → 目标类名"这一跳也钉住：目标类必须出现在渲染层源码里。
     */
    const gated = [...css.matchAll(/\[data-[a-z-]+='[^']*'\]\s+\.([a-z][a-z0-9-]*)/g)].map((m) => m[1] ?? '');
    // 防失焦：先确认真的扫到了这类规则（现在有 4 条），否则扫描写坏会空转通过
    expect(gated.length).toBeGreaterThan(0);
    const sourcesText = sources.join('\n');
    const orphan = [...new Set(gated)].filter((cls) => !sourcesText.includes(cls));
    expect(orphan).toEqual([]);
  });
});
