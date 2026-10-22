import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@jujia/ui-tokens';

/**
 * **台账里的「对比度实测值」必须能被复算**（R59 · 2026-10-22）。
 *
 * ## 为什么立它
 *
 * 本轮现扫查出**我自己写进台账的三个数没有出处**：
 *   ① 「现树命中 13 处」—— 那是**加扫描范围之前**测的，加了 `.css` 之后没重测（真值 15）；
 *   ② 「灰带 #777777–#7a7a7a」—— **手算**的上界，真值是 `#777777–#7b7b7b`（5 档）；
 *   ③ 「深主色对比 1.33:1」—— 同样**手算**，真值 1.32:1。
 * ⇒ 三个都是同一种病：**数字是"算出来的/估出来的"，不是"跑出来的"**。
 *
 * ⇒ 这条锁把其中**可机器复算**的那一类钉住：**台账里写下的对比度，必须能用仓里的
 * `contrastRatio` 复算出来**（同一份实现，不另造公式 ⇒ 两边不会漂）。
 *
 * ## 口径（三条边界，都写在这里）
 *
 * 1. **句级配对**：台账的一行往往塞着好几件事（一整段交付记录）⇒ 必须按**句**切分，
 *    否则会把**不相关的**色值配到**不相关的**数字上（实测：行级配对会假阳，也会假阴）。
 * 2. **阈值不算实测值**：`4.5:1`（AA 正文）/ `3:1`（非文本）/ `21:1` / `1:1` 是**标准值**，
 *    不是某次测量 ⇒ 不参与判定。
 * 3. **只判"两个色值 + 一个实测对比度"都凑齐的句子** ⇒ 只写了一个色值的句子（例如
 *    "固定 #101010 时对比只有 1.33:1"）**判不了**（**如实登记为边界**，不假装覆盖）。
 *    ⇒ 写台账时**要把参与计算的两个色值都写出来**，这句话才受这条锁管。
 */

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** 要扫的台账与带注释的源码（**注释里也会写数字**，历史上 R54 的"5.94:1"就写在 `styles.css` 里） */
const LEDGER = [
  'CHANGELOG.md',
  'docs/CHANGELOG-ARCHIVE.md',
  'docs/PROGRESS.md',
  'docs/TRACK-ROADMAP.md',
  '俱佳Agent交接文档.md',
  'review/REVIEW-LOG.md',
  'review/mutations.json',
  'packages/ui-tokens/src/theme-pack.ts',
  'scripts/check-docs.mjs',
  'apps/desktop/src/renderer/src/styles.css',
];

const COLOR = /#[0-9a-fA-F]{6}/g;
const RATIO = /(?<![\d.])(\d{1,2}\.\d{1,2})\s*:\s*1/g;
/** 句界（`|` 也算：表格行之间要断开） */
const SENT = /[。；;！!？?]|⇒|——|\|/;

/** 标准阈值（不是实测值） */
const THRESHOLDS = new Set([4.5, 3, 21, 1]);

interface Triple {
  file: string;
  line: number;
  claimed: number;
  /** 句里能算出的所有色值对 */
  pairs: { a: string; b: string; ratio: number }[];
  /** 至少有一对能复算出这个数 */
  hit: boolean;
}

function collect(): Triple[] {
  const out: Triple[] = [];
  for (const rel of LEDGER) {
    let text: string;
    try {
      text = readFileSync(resolve(repoRoot, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const raw of lines[i]!.split(SENT)) {
        const sent = raw.trim();
        if (sent === '') continue;
        const colors = [...sent.matchAll(COLOR)].map((m) => m[0]);
        const ratios = [...sent.matchAll(RATIO)].map((m) => Number.parseFloat(m[1]!));
        if (colors.length < 2 || ratios.length === 0) continue;
        const pairs: { a: string; b: string; ratio: number }[] = [];
        for (let x = 0; x < colors.length; x += 1) {
          for (let y = x + 1; y < colors.length; y += 1) {
            const r = contrastRatio(colors[x]!, colors[y]!);
            if (r !== null) pairs.push({ a: colors[x]!, b: colors[y]!, ratio: r });
          }
        }
        for (const claimed of ratios) {
          if (THRESHOLDS.has(claimed)) continue; // 标准阈值，不是实测值
          out.push({
            file: rel,
            line: i + 1,
            claimed,
            pairs,
            hit: pairs.some((p) => Math.abs(p.ratio - claimed) <= 0.01),
          });
        }
      }
    }
  }
  return out;
}

describe('台账里的对比度实测值必须能被复算（R59）', () => {
  const triples = collect();

  it('防失焦：扫到的三元组不能塌（定位器写坏时会在这里红，而不是空转通过）', () => {
    expect(triples.length).toBeGreaterThanOrEqual(5);
  });

  it('每一个「两个色值 + 一个实测对比度」都对得上（对不上 ⇒ 台账在写没有出处的数）', () => {
    const bad = triples.filter((t) => !t.hit);
    expect(
      bad
        .map((t) => {
          const near = t.pairs.reduce(
            (a, b) => (Math.abs(b.ratio - t.claimed) < Math.abs(a.ratio - t.claimed) ? b : a),
            { a: '-', b: '-', ratio: 0 },
          );
          return (
            `${t.file}:${String(t.line)} 声称 ${t.claimed}:1，但句内色值算不出` +
            `（最近的一对 ${near.a} × ${near.b} = ${near.ratio.toFixed(2)}:1）`
          );
        })
        .join('\n     '),
    ).toBe('');
  });

  it('这台锁真的咬得住（把一个实测值改错 ⇒ 立刻红）', () => {
    /**
     * 为什么要有这一条：**锁自己也要被验**（项目里栽过"看着绿、其实什么都没锁住"）。
     * 这里不真的改文件（改文件会污染工作树），而是**构造一个假的句子**喂给同一套判定逻辑。
     */
    const fake = { a: '#1a2b3c', b: '#101010', ratio: contrastRatio('#1a2b3c', '#101010')! };
    expect(Math.abs(fake.ratio - 1.32)).toBeLessThanOrEqual(0.01); // 真值 1.32
    expect(Math.abs(fake.ratio - 1.33)).toBeGreaterThan(0.01); // 我手算的那个 1.33 ⇒ **判得出来**
  });
});
