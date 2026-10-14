import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `useMemo` 里不许读 `xxxRef.current`（T46 · 2026-10-14 审计清零批）。
 *
 * **为什么单挑 useMemo，不管 useCallback**：回调在"被调用那一刻"读 ref，读到的就是当下值，
 * 这是 ref 的正常用法；`useMemo` 的值是**缓存**的，只有依赖变了才重算 ——
 * 而 ref 变了不会触发重渲染，所以依赖数组里**根本放不进"ref 的当前值"**。
 * 于是 memo 里读 `ref.current` = 结构上必然读到过期值，与"忘了加依赖"是同一个洞，
 * 但 `react-hooks/exhaustive-deps` 那条 ESLint 规则**看不见它**（它只查标识符是否在数组里，
 * `viewportRef` 确实在依赖之外也没人管，而 `.current` 的变化它无从知道）。
 *
 * **为什么这条立成扫源码而不是装插件**：`eslint-plugin-react-hooks` 本仓没有，
 * 装它属于停牌②（新增依赖），不在本轮范围内。扫源码这条判据零容忍（今天 65 个渲染层文件里
 * 只有一处命中，就是被审计点名的画布视口），所以它能守住这一类而不需要豁免清单。
 *
 * 现场：`CanvasPanel.tsx` 的 `graph` memo 读 `viewportRef.current`，而 `onMoveEnd` 只写 ref ——
 * 结果是"只平移、不编辑节点"之后保存，落盘的视口是**上一次编辑时**的那个（回放出来是错的）。
 */

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = `${dir}${name}`;
    if (statSync(p).isDirectory()) out.push(...sourceFiles(`${p}/`));
    // `.ts` 也扫：自定义 hook 里同样会写 useMemo（探针实测渲染层 65 个源文件，只有画布这一处命中）
    else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

/** 括号配平地从 `useMemo(` 之后扫到与之匹配的 `)`，拿到整段实参文本 */
function useMemoBodies(src: string): { line: number; body: string }[] {
  const hits: { line: number; body: string }[] = [];
  const re = /useMemo\(/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    hits.push({ line: src.slice(0, start).split('\n').length, body: src.slice(start, i) });
    m = re.exec(src);
  }
  return hits;
}

describe('useMemo 不读 ref.current（缓存值 × 变化不触发重渲染 = 必然过期）', () => {
  it('渲染层每一处 useMemo 的表达式里都不出现 xxxRef.current', () => {
    const files = sourceFiles(SRC);
    // 绝对下限（证据完整性第 4 条）：路径写错时清单会静默清空，"零违规"就成了假绿。
    // 40 这个数对着 2026-10-14 实扫的 42 个非测试源文件留出一点余量。
    expect(files.length, '扫描范围不能是空的（路径写错就等于这条锁不存在）').toBeGreaterThanOrEqual(40);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const { line, body } of useMemoBodies(src)) {
        const refs = [...new Set([...body.matchAll(/([A-Za-z0-9_]+Ref)\.current/g)].map((x) => x[1]))];
        if (refs.length > 0) {
          offenders.push(`${f.replace(SRC, '')}:${String(line)} 读到 ${refs.join(', ')}`);
        }
      }
    }
    expect(offenders, `memo 里读到 ref.current 的位置：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('画布保存用的就是当下视口（审计点名的那一处，钉住写法）', () => {
    const src = readFileSync(`${SRC}features/canvas/CanvasPanel.tsx`, 'utf8');
    // memo 的表达式与依赖数组必须指向**同一份**视口来源（读 state 而非读 ref）
    expect(src).toMatch(/const graph = useMemo\(\s*\(\) => toGraph\(nodes, edges, connectionId, viewport\),\s*\[nodes, edges, connectionId, viewport\],/);
    expect(src).not.toMatch(/toGraph\([^)]*viewportRef\.current/);
    // 平移结束时要把视口**写进状态**，只写 ref 等于没人看（原缺陷的形状）
    expect(src).toMatch(/setViewportState\(\{ x: vp\.x, y: vp\.y, zoom: vp\.zoom \}\)/);
  });
});
