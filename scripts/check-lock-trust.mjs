#!/usr/bin/env node
/**
 * 锁可信度判据（R83 · 「锁自己可不可信」主线下的一轮）。
 *
 * ## 为什么要有它
 *
 * R70 在 `icons.test.tsx` 逮到一条**真的**：那条锁的标题写着「许可声明在模块里（ISC 要求随副本保留）」，
 * 实际只断言了「模块里有这个字符串」⇒ **判据宣称的覆盖面 ≠ 它实际测到的覆盖面** ⇒
 * 它绿了 11 轮，而它声称守的那件事（声明随副本保留）一直是假的。
 *
 * 那一类坏法有个共同形状：**标题比断言宽**。
 * 标题说「全仓只有一处」，断言只数了那一个文件里的出现次数；标题说「七个」，断言只验了
 * **测试自己手写的那七个名字**都存在；标题说「没有通用命令通道」，断言只禁了四个具体名字。
 * ⇒ 本脚本把这类形状做成**通则判据**，让「标题比断言宽」当场红，而不是等人读代码才发现。
 *
 * ## 五条规则（每条都是"标题的声称 ⇒ 断言体必须真的做到"）
 *
 * | 规则 | 标题里出现 | 断言体必须有的 |
 * |------|------------|----------------|
 * | R-A 强断言 ⇒ 有可失败断言 | 不许 / 不得 / 必须 / 一律 / 始终 / 保持 / 一致 | 至少一条会失败的断言（`expect` / `assert` / `findBy` / `waitFor` / report 的判定式） |
 * | R-B 全称量词 ⇒ 有遍历 | 每个 / 全部 / 所有 / 每一 / 全体 / 任何 | 遍历或枚举结构（`for` / `every` / `forEach` / `map` …） |
 * | R-C 数量承诺 ⇒ 有数量断言 | `7 条` / `三条` / `只有…一处` | 数量型断言（`.length` / `count` / `size` / `toHaveLength`） |
 * | R-D 范围承诺 ⇒ 真扫那个范围 | 全仓 / 所有文件 / 随副本保留 / 构建产物 | 该测试文件真的做了跨文件扫描 / 真的触及产物 |
 * | R-E 记号对得上 | 标题里的文件名 / 类名 / snake_case 标识符 / 引号字面量 | 断言体（或该锁的 import / 读文件）里出现同一个记号 |
 *
 * ## 判据自己的覆盖面（必须等于它实际测到的覆盖面）
 *
 * 这份判据**只**检查"标题里的声称有没有被断言体接住"。
 * 它**不**检查：
 *   - 断言本身对不对（那是变异测试与单测自己的事）；
 *   - 纯中文散文式的主张（例如「三个门都是人驱动的」）—— 中文散文没有唯一记号，机器判不了，
 *     这类由 R82 的台账人工过一遍，**不假装机器能判**；
 *   - `check-docs.mjs` 的 report 锁只按它所在顶层块内的判定式算（作用域是那一块，不是整份文件）。
 *
 * ⇒ 宁可漏判，不可错判：**一条判据乱报，比没有这条判据更坏**。
 *
 * 用法：
 *   node scripts/check-lock-trust.mjs            # 人读的输出
 *   node scripts/check-lock-trust.mjs --json     # 机器读的输出
 * 退出码：0 = 全过；1 = 有违规；2 = 用法/环境错
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `--root <dir>`：换一个根目录去扫（自检用夹具）。默认是本仓根。 */
function rootArg() {
  const i = process.argv.indexOf('--root');
  if (i >= 0 && process.argv[i + 1]) return resolve(process.argv[i + 1]);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}
const repoRoot = rootArg();
const asJson = process.argv.includes('--json');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.tmp', '.trash', '.evidence', 'coverage', '.vitest']);

/* ------------------------------------------------------------------ *
 * 一、把仓里的"锁"抽出来
 * ------------------------------------------------------------------ */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** `/` 是正则字面量的开头还是除号？——看前一个有意义的字符 */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n']);
function isRegexStart(src, i) {
  for (let j = i - 1; j >= 0; j--) {
    const c = src[j];
    if (c === ' ' || c === '\t' || c === '\r') continue;
    if (c === '\n') return true;
    return REGEX_PRECEDERS.has(c);
  }
  return true;
}

/** 跳过一个正则字面量 */
function skipRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '\n') return i + 1; // 不是正则（是除号）
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') inClass = true;
    else if (c === '/') return j + 1;
    j++;
  }
  return j;
}

/** 配对圆括号（跳过注释 / 字符串 / 模板 / 正则字面量） */
function matchParen(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let inTmpl = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (inTmpl) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') inTmpl = false;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === '/' && isRegexStart(src, i)) {
      const after = skipRegex(src, i);
      if (after > i + 1) {
        i = after;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      inStr = c;
      i++;
      continue;
    }
    if (c === '`') {
      inTmpl = true;
      i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { close: i, inner: src.slice(openIdx + 1, i) };
    }
    i++;
  }
  return null;
}

/** 配对花括号 */
function matchBrace(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let inTmpl = false;
  let lc = false;
  let bc = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (lc) {
      if (c === '\n') lc = false;
      i++;
      continue;
    }
    if (bc) {
      if (c === '*' && n === '/') {
        bc = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (inTmpl) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') inTmpl = false;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      lc = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      bc = true;
      i += 2;
      continue;
    }
    if (c === '/' && isRegexStart(src, i)) {
      const after = skipRegex(src, i);
      if (after > i + 1) {
        i = after;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      inStr = c;
      i++;
      continue;
    }
    if (c === '`') {
      inTmpl = true;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return src.length - 1;
}

/** 取第一个参数里的字符串字面量；不是字面量则返回 null */
function firstArgLiteral(inner) {
  const trimmed = inner.trimStart();
  const q = trimmed[0];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let i = 1;
  let out = '';
  while (i < trimmed.length) {
    const c = trimmed[i];
    if (c === '\\') {
      const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`', '$': '$' };
      out += map[trimmed[i + 1]] ?? trimmed[i + 1];
      i += 2;
      continue;
    }
    if (c === q) break;
    out += c;
    i++;
  }
  if (trimmed[i] !== q) return null;
  return { title: out, rest: trimmed.slice(i + 1) };
}

/** 把实参切开（按顶层逗号） */
function splitArgs(rest) {
  const args = [];
  let depth = 0;
  let cur = '';
  let inStr = null;
  let inTmpl = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (inStr) {
      cur += c;
      if (c === '\\') {
        cur += rest[++i] ?? '';
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (inTmpl) {
      cur += c;
      if (c === '\\') {
        cur += rest[++i] ?? '';
        continue;
      }
      if (c === '`') inTmpl = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === '`') {
      inTmpl = true;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src[i] === '\n') n++;
  return n;
}

/** 抽出 vitest 的 `it(...)` / `test(...)` 锁 */
function extractVitestLocks(rel, src) {
  const locks = [];
  const describes = [];
  const re = /\b(describe|it|test)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const kw = m[1];
    const openIdx = m.index + m[0].length - 1;
    const r = matchParen(src, openIdx);
    if (!r) continue;
    const lit = firstArgLiteral(r.inner);
    if (!lit) {
      if (kw === 'describe') describes.push('<dynamic>');
      continue;
    }
    if (kw === 'describe') {
      describes.push(lit.title);
      continue;
    }
    const arrow = lit.rest.indexOf('=>');
    let body = '';
    if (arrow >= 0) {
      const after = lit.rest.slice(arrow + 2);
      const brace = after.indexOf('{');
      body = brace >= 0 ? after.slice(brace, matchBrace(after, brace) + 1) : after;
    }
    locks.push({
      kind: 'vitest',
      file: rel,
      line: lineOf(src, m.index),
      suite: describes.join(' › '),
      title: lit.title,
      body,
    });
    re.lastIndex = r.close;
  }
  return locks;
}

/** 抽出 check-docs.mjs 的 `report(...)` 锁，作用域 = 它所在的那一层 `{ }` 块 */
function extractReportLocks(rel, src) {
  const locks = [];
  const re = /\breport\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const openIdx = m.index + m[0].length - 1;
    const r = matchParen(src, openIdx);
    if (!r) continue;
    const lit = firstArgLiteral(r.inner);
    if (!lit) continue;
    const args = splitArgs(lit.rest);
    // 作用域：往前找最近一个行首 `{`，再往后配对到它的 `}`
    let scopeStart = 0;
    const before = src.slice(0, m.index);
    const blockIdx = before.lastIndexOf('\n{');
    if (blockIdx >= 0) scopeStart = blockIdx + 1;
    const scopeEnd = matchBrace(src, scopeStart);
    locks.push({
      kind: 'report',
      file: rel,
      line: lineOf(src, m.index),
      suite: 'check-docs',
      title: lit.title,
      body: src.slice(scopeStart, scopeEnd + 1),
      cond: args[1] ?? '',
    });
    re.lastIndex = r.close;
  }
  return locks;
}

/* ------------------------------------------------------------------ *
 * 二、判定用的词表与工具
 * ------------------------------------------------------------------ */

/** 强断言词：标题里出现即视为"声称了一个不许/必须成立的事实" */
const STRONG_WORDS = ['不许', '不得', '必须', '一律', '始终', '永远', '保持', '一致', '不该', '杜绝', '零 '];

/**
 * 全称量词：声称覆盖"全体"，必须有遍历。
 *
 * 只取**不会多义**的写法：
 *   · `每个` / `全体` / `逐个` —— 在中文里只作全称覆盖讲；
 *   · `每一` + **分类量词**（类/种/个/项/处/条）—— 分类量词后面必有"一堆东西"可枚举。
 * 而 `每一轮` / `每一次` / `每一只` / `每一块` 是**时间或单位上的重复**，不是"要枚举一堆" ⇒ 不取。
 */
const QUANT_WORDS = ['全体'];
const QUANT_CLASS_RE = /每一(?:类|种|个|项|处|条)/;
/** `每个` + **中文名词**才算全称覆盖（"每个 tick"是时间上的重复，不是"要枚举一堆"） */
const QUANT_EACH_RE = /每个[一-鿿]/;

/** 数量承诺：声称了"有 N 个"，必须钉住数量 */
const QUANT_UNITS = '条|种|个|项|处|款|行|类|张|根|组|支|套|页|扇|份|道|人';
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 范围承诺 */
const SCOPE_REPO = /全仓|全库|整个仓|所有文件|每个文件/;
const SCOPE_DIST = /随副本保留|副本保留|随包|分发副本|构建产物|打包产物|产物里|产物中|装进发行版/;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const countOf = (s, re) => (s.match(re) || []).length;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * 标题里的「对象型记号」——**这条锁在管的到底是什么**。
 *
 * 只取三类：
 *   · 文件名（`channels.ts`）—— 说"这条锁在管哪个文件"；
 *   · CSS 类名（`.jj-icon-btn`）—— 说"这条锁在管哪个样式钩子"；
 *   · 点号路径（`a.b.c`）—— 说"这条锁在管哪个模块路径"。
 *
 * **不取**引号字面量与裸标识符：它们在中文标题里多半是**理据或被否对象**
 * （「不是 network_error」「不产生 KEY=undefined」）—— 标题举它是为了说明"不是什么"，
 * 不是要断言它 ⇒ 拿它们当门禁会误报一大片。
 */
function markersOf(title) {
  const out = new Set();
  const add = (v) => {
    const s = v.trim();
    if (s && /[A-Za-z0-9]/.test(s) && !/[一-鿿]/.test(s) && !s.includes('*')) out.add(s);
  };
  for (const m of title.matchAll(/\.[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g)) add(m[0]); // CSS 类名
  for (const m of title.matchAll(/(?<![\w.])\.[a-zA-Z_$][\w$]*(?:\.[\w$]+)+/g)) add(m[0]); // 点号路径
  for (const m of title.matchAll(/(?<![\w/.-])[\w-]+\.(?:ts|tsx|mjs|js|json|md|css)\b/g)) add(m[0]); // 文件名
  return [...out];
}

/** 该测试文件 import 了什么 / 读了什么文件 —— 记号"被触及"的第二来源 */
function fileScope(src) {
  const imports = new Set();
  const importPaths = new Set();
  const importRe = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src))) {
    const clause = m[1];
    const path = m[2];
    importPaths.add(path);
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const t = part.trim().replace(/^type\s+/, '');
        const alias = t.split(/\s+as\s+/);
        const name = (alias[1] ?? alias[0]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) imports.add(name);
      }
    }
    const def = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim();
    for (const nm of def.split(/\s+/)) if (/^[A-Za-z_$][\w$]*$/.test(nm)) imports.add(nm);
  }
  const reads = new Set();
  for (const r of [/'([^']*\.(?:ts|tsx|js|mjs|json|md|css))'/g, /"([^"]*\.(?:ts|tsx|js|mjs|json|md|css))"/g]) {
    while ((m = r.exec(src))) reads.add(m[1]);
  }
  return { imports, importPaths, reads };
}

/* ------------------------------------------------------------------ *
 * 三、五条规则
 * ------------------------------------------------------------------ */

/**
 * 标题里的**数量承诺** ⇒ { n, text }；不是承诺则返回 null。
 *
 * 只认"承诺一个可数的集合"，三类一律排除：
 *   ① **序数**：「第 51 条」「第二套」「第三个接入点」—— 说的是**哪一个**，不是**有几个**；
 *   ② **指示代词**：「那三个字符」「上面三条」—— 指的是别处提过的东西；
 *   ③ **括注**：「（这三个门都是人驱动的）」—— 括注里的数字多半是**上下文**，不是这条锁的承诺
 *      （括注里的那批由 R82 台账人工过一遍，机器不判）。
 */
function countClaimOf(title) {
  // ③ 先剥掉括注
  const main = title.replace(/[（(「『【][^）)」』】]*[）)」』】]/g, ' ');

  const isOrdinalOrDemonstrative = (idx) => {
    const win = main.slice(Math.max(0, idx - 8), idx);
    if (win.includes('第')) return true; // 序数：第 N / 第二 / 第三
    if (/(这|那|多|另)\s*$/.test(win)) return true; // 指示代词
    if (/(上|下)面?\s*$/.test(win)) return true; // 上面 / 下面
    return false;
  };

  const ar = new RegExp(`(\\d+)\\s*(?:${QUANT_UNITS})`, 'g');
  let m;
  while ((m = ar.exec(main)) !== null) {
    if (isOrdinalOrDemonstrative(m.index)) continue;
    const n = Number(m[1]);
    if (n >= 2) return { n, text: m[0] };
    return null;
  }
  const cn = new RegExp(`([二三四五六七八九十])\\s*(?:${QUANT_UNITS})`, 'g');
  while ((m = cn.exec(main)) !== null) {
    if (isOrdinalOrDemonstrative(m.index)) continue;
    const n = CN_NUM[m[1]];
    if (n >= 2) return { n, text: m[0] };
  }
  /**
   * ⚠️ 「只有/仅有/恰好…N」**不在**本规则的范围内：
   * 「只有执行类工具能声明 commandArg」是**类别限制**（哪一类可以），不是**数量承诺**（有几个）；
   * 而它的正确判法是**枚举**（扫全表，逐个验）⇒ 那是 R-B 的事。
   * ⇒ 这里不取，免得把好锁误判成缺陷（实测：`executor.test.ts` 那条把整个注册表扫了一遍，是好锁）。
   */
  return null;
}

/** 断言体里有没有**内联数组字面量**，各有几个元素 */
function inlineArrayLengths(body) {
  const out = [];
  const re = /\[/g;
  let m;
  while ((m = re.exec(body))) {
    const start = m.index;
    let depth = 0;
    let i = start;
    let inStr = null;
    let commas = 0; // 顶层逗号数
    let hasContent = false; // 当前顶层元素里有没有非空白内容
    for (; i < body.length; i++) {
      const c = body[i];
      if (inStr) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c;
        hasContent = true;
        continue;
      }
      if (c === '[' || c === '{' || c === '(') {
        depth++;
        if (depth >= 2) hasContent = true; // 顶层元素是个嵌套结构 ⇒ 它算一个元素
        continue;
      }
      if (c === ']' || c === '}' || c === ')') {
        depth--;
        if (depth === 0) break;
        continue;
      }
      if (depth === 1 && c === ',') {
        commas++;
        hasContent = false;
        continue;
      }
      if (depth === 1 && !/\s/.test(c)) hasContent = true;
    }
    const len = commas + (hasContent ? 1 : 0);
    if (depth === 0 && len > 0) out.push(len);
  }
  return out;
}

/**
 * 数量有没有被**钉住**？
 *
 * 钉住的方式（都算）：
 *   ① 数量型断言：`.length` / `count` / `size` / `toHaveLength`；
 *   ② **内联清单**：断言体里有个数组字面量（`toEqual(['a','b','c'])` 这类）——
 *      清单变了就红 ⇒ 数量也就被钉住了；
 *   ③ **数字字面量出现在断言体里**：如 `expect(shouldAskAgain(8, 8)).toBe(false)`
 *      ——「记要点时是 8 条」这个承诺**就是在断言里被钉住的**（8 变了语义就变了）；
 *   ④ **断言条数 ≥ 承诺数**：标题说「三处都在」并**自己点名**了那三处，而断言体里也确有
 *      三条独立断言 ⇒ 这三条各有一条断言兜着 ⇒ 数量是被覆盖的
 *      （实测：`terminal-lifecycle-wiring` 那条「channels.ts → ipc 注册 → preload 暴露，三处都在」
 *      正是这个形状 —— 收口方式是把标题里的「三处」**收掉**，而不是给断言加数量）。
 *
 * ⚠️ 为什么不要求"数组长度**恰好等于**标题里那个数"：
 *   标题常说的是清单的**一部分**（「三个文件工具 + run_command + append_note」= 5 个），
 *   拿"3"去比"5"会**误报一条好锁**（实测：`executor.test.ts` 那条用
 *   `toEqual([...5 项])` 把清单钉得死死的，却被判成"数量没钉住"）。
 *   ⇒ 这里只问"**有没有把数量钉住**"，不猜"是哪一个数"。
 */
function countIsPinned(body, n) {
  if (/\.length\b|\bcount\b|\bCount\b|\.size\b|toHaveLength/.test(body)) return true;
  if (inlineArrayLengths(body).some((len) => len >= 1)) return true;
  // ③ 数字字面量出现在断言体里（如 `expect(BUNDLED_CMAP_COUNT).toBe(43)`）
  //    ⚠️ 比的是**整个数**，不是它的每一位（43 的每位是 4 与 3 —— 拿它们去比会认不出 43）
  const nums = body.match(/\d+/g) ?? [];
  if (nums.some((x) => Number(x) === n)) return true;
  // ④ 断言条数 ≥ 承诺数（`findBy*` 也算 —— 找不到就 reject，是会失败的断言）
  const asserts =
    (body.match(/\bexpect\w*\s*\(/g) || []).length +
    (body.match(/\bassert\w*\s*\(/g) || []).length +
    (body.match(/\bfindBy\w*\s*\(/g) || []).length +
    (body.match(/\bwaitFor\w*\s*\(/g) || []).length;
  return asserts >= n;
}

function checkLock(lock, scope) {
  const violations = [];
  const title = lock.title;
  const clean = stripComments(lock.body ?? '');
  const bodyNorm = norm(clean);
  const scopeNorm = norm(scope.src);

  const expectCount = countOf(clean, /\bexpect\w*\s*\(/g) + countOf(clean, /\bassert\w*\s*\(/g);
  // `findBy*` / `waitFor*` 找不到就 reject ⇒ **会失败**，不是空转
  const asyncCount = countOf(clean, /\bfindBy\w*\s*\(/g) + countOf(clean, /\bwaitFor\w*\s*\(/g);
  const hasFailable = expectCount + asyncCount > 0 || (lock.kind === 'report' && (lock.cond ?? '').trim().length > 0);

  // R-A 强断言 ⇒ 有可失败断言
  if (STRONG_WORDS.some((w) => title.includes(w)) && !hasFailable) {
    violations.push({ rule: 'R-A', why: '标题含强断言词，但断言体里没有任何会失败的断言' });
  }

  // R-B 全称量词 ⇒ 有遍历/枚举
  if (QUANT_WORDS.some((w) => title.includes(w)) || QUANT_CLASS_RE.test(title) || QUANT_EACH_RE.test(title)) {
    /**
     * "枚举"有两种写法，都算数：
     *   ① 显式遍历：for / forEach / every / map / filter / reduce / some；
     *   ② **结构不变量**：不写循环，但把"全体"翻译成一个计数比较
     *      （例：`members` = 契约里的成员数，`withSession` = 带该字段的成员数，断言两者相等）。
     *      少了 ②，这种好锁会被误判成"没枚举" ⇒ 宁可漏判不可错判，这里把它认下来。
     */
    const hasLoop =
      /\bfor\s*\(|\bfor\s+await|\.forEach\s*\(|\.every\s*\(|\.map\s*\(|\.filter\s*\(|\.reduce\s*\(|\.some\s*\(/.test(clean);
    const hasCountShape = /\.length\b|\.match\s*\(|toBeGreaterThan/.test(clean);
    if (!hasLoop && !hasCountShape) {
      violations.push({ rule: 'R-B', why: '标题声称覆盖全体，但断言体里没有遍历/枚举/计数结构' });
    }
  }

  // R-C 数量承诺 ⇒ 有数量型断言
  //
  // 只认**承诺**，不认**输入**：
  //   · 「第 51 条」是序号（哪一条被拒），不是承诺"有 51 条" ⇒ 不算；
  //   · 「0 页 / 非整数」「1 页与等于上限」说的是被喂进去的输入，不是这条锁断言了什么 ⇒ 不算（数字 < 2 也不取）；
  //   · 「三个接入点」「七条 git 通道」是在承诺一个可数的集合 ⇒ 算，必须钉住。
  const claim = countClaimOf(title);
  if (claim) {
    if (!countIsPinned(clean, claim.n)) {
      violations.push({ rule: 'R-C', why: `标题承诺了数量「${claim.text}」，但断言体里没有把数量钉住` });
    }
  }

  // R-D 范围承诺 ⇒ 真扫那个范围
  if (SCOPE_REPO.test(title)) {
    const scans = /readdirSync|readdir\(|glob|walk\(|collect\(|scanAll|allFiles|\bwalk\b/.test(scope.src);
    if (!scans) {
      violations.push({ rule: 'R-D', why: '标题声称扫全仓，但该测试文件里没有任何跨文件扫描' });
    }
  }
  if (SCOPE_DIST.test(title)) {
    const touches =
      /dist|\bout\b|\.asar|packag|build\/|产物|发行版|release/.test(clean) ||
      /dist|\bout\b|\.asar|packag/.test(scope.src);
    if (!touches) {
      violations.push({ rule: 'R-D', why: '标题声称"随副本/产物里"，但断言体与该文件都没触及产物' });
    }
  }

  // R-E 记号对得上
  const ms = markersOf(title);
  const unmatched = ms.filter((m) => {
    const nm = norm(m);
    if (nm && bodyNorm.includes(nm)) return false;
    /**
     * 文件名记号的"触及"有三种，都算数：
     *   ① 断言体里出现完整文件名；
     *   ② 断言体里出现它的**词干**当标识符（`channels.GIT_STATUS` ⇒ 确实在管 channels.ts）；
     *   ③ 这条锁 import 了它 / 读了它。
     * 只认 ① 会把「`channels.GIT_STATUS`」这种写法误判成"没触及" ⇒ 那条锁其实在管它。
     */
    const stem = m.replace(/\.[a-z]+$/, '');
    if (/^[A-Za-z][\w-]*$/.test(stem)) {
      const stemRe = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (stemRe.test(clean)) return false;
    }
    const base = norm(m.replace(/\.[a-z]+$/, ''));
    const touched = [...(scope.importPaths ?? []), ...(scope.reads ?? [])];
    if (base && touched.some((p) => norm(p).includes(base))) return false;
    return true;
  });
  if (unmatched.length) {
    violations.push({ rule: 'R-E', why: `标题里的记号没在断言体里出现：${unmatched.join(' | ')}` });
  }

  return violations;
}

/* ------------------------------------------------------------------ *
 * 四、跑起来
 * ------------------------------------------------------------------ */

function collectLocks() {
  const files = walk(repoRoot);
  const locks = [];
  const scopes = new Map();
  for (const file of files) {
    if (!/\.test\.(ts|tsx)$/.test(file)) continue;
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    scopes.set(rel, { src, ...fileScope(src) });
    locks.push(...extractVitestLocks(rel, src));
  }
  const docsPath = join(repoRoot, 'scripts', 'check-docs.mjs');
  if (existsSync(docsPath)) {
    const rel = 'scripts/check-docs.mjs';
    const src = readFileSync(docsPath, 'utf8');
    scopes.set(rel, { src, ...fileScope(src) });
    locks.push(...extractReportLocks(rel, src));
  }
  return { locks, scopes };
}

const { locks, scopes } = collectLocks();
const findings = [];
for (const lock of locks) {
  const scope = scopes.get(lock.file) ?? { src: '', imports: new Set(), importPaths: new Set(), reads: new Set() };
  for (const v of checkLock(lock, scope)) {
    findings.push({ file: lock.file, line: lock.line, kind: lock.kind, title: lock.title, ...v });
  }
}

/* ------------------------------------------------------------------ *
 * 五、基线棘轮：只许变严，不许变松
 * ------------------------------------------------------------------ *
 *
 * 为什么要有基线：这条判据一上来就逮住 47 处**存量**问题（大多是真的），
 * 而一次性全修不是一轮能做完的事 ⇒ 直接当门禁会变成"一红就没人看"。
 *
 * 棘轮的做法（和本仓 `review/mutations.json` 同一套思路）：
 *   · **新问题**（不在基线里）⇒ 红。**这是判据的主要价值**：R70 那类坏法当场红。
 *   · **基线里已修好的**（基线有、现扫没有）⇒ 红。逼着人回来改基线 ⇒ 基线不会烂在原地。
 *   · 其余（还在基线里）⇒ 放行，但**逐条列出来**，让人看得见存量在缩。
 *
 * ⇒ 基线是**收口清单**，不是免责声明：每条都带一句"为什么现在还这样"。
 */

const keyOf = (f) => `${f.file}::${f.rule}::${f.title}`;

const baselinePath = resolve(repoRoot, 'review', 'lock-trust-baseline.json');
let baseline = { note: '', findings: [] };
if (existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (err) {
    console.error(`❌ 基线文件读不出来：${baselinePath}（${err.message}）`);
    process.exit(2);
  }
}
const baselineKeys = new Map((baseline.findings ?? []).map((b) => [keyOf(b), b]));
const findingKeys = new Map(findings.map((f) => [keyOf(f), f]));

const fresh = findings.filter((f) => !baselineKeys.has(keyOf(f)));
const stale = [...baselineKeys.keys()].filter((k) => !findingKeys.has(k));

if (process.argv.includes('--write-baseline')) {
  const payload = {
    note:
      '锁可信度判据的存量基线（棘轮）。每条 = "标题宣称的覆盖面比断言宽"，且已登记原因。\n' +
      '· 新问题（不在本表里）⇒ 判据红 ⇒ 必须当场修，不得往表里加；\n' +
      '· 表里某条被修好（现扫查不到）⇒ 判据也红 ⇒ 逼你回来删它 ⇒ 本表只许缩、不许涨。',
    findings: findings
      .map((f) => ({
        file: f.file,
        rule: f.rule,
        title: f.title,
        why: f.why,
        reason: '存量：已登记，待收口（见 review/REVIEW-LOG.md 的 R82–R84）',
      }))
      .sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`基线已写入：${baselinePath}（${payload.findings.length} 条）`);
  process.exit(0);
}

const summary = {
  scannedLocks: locks.length,
  scannedFiles: scopes.size,
  total: findings.length,
  baseline: baselineKeys.size,
  fresh: fresh.length,
  stale: stale.length,
  findings,
  freshFindings: fresh,
  staleKeys: stale,
};

if (asJson) {
  console.log(JSON.stringify(summary, (_k, v) => (v instanceof Set ? [...v] : v), 2));
} else {
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  console.log(`扫了 ${locks.length} 条锁（${scopes.size} 个文件）｜存量 ${findings.length} 处｜基线 ${baselineKeys.size} 条`);
  if (findings.length > 0) console.log('各规则命中：' + JSON.stringify(byRule));

  if (fresh.length === 0 && stale.length === 0) {
    console.log('✅ 棘轮持平：没有新问题，基线里的存量也都还在（待收口）');
  }
  if (fresh.length > 0) {
    console.log(`\n❌ 新出现 ${fresh.length} 处"标题比断言宽"（不在基线里）——这必须当场修，不许进基线：`);
    for (const f of fresh) console.log(`  [${f.rule}] ${f.file}:${f.line}  ${f.title}\n        ${f.why}`);
    console.log(
      '\n怎么修（按这条锁真正想守的那件事选一条）：\n' +
        '  · 标题确实比断言宽 ⇒ 把断言补齐到标题的覆盖面\n' +
        '  · 断言本来就是这个意思 ⇒ 把标题收窄到断言的覆盖面（照 icons.test.tsx 在 R70 的做法）\n' +
        '  · 这条锁守的其实在别处 ⇒ 在标题里写明"另见 XXX"，别让这句标题独自冒充全貌',
    );
  }
  if (stale.length > 0) {
    console.log(`\n❌ 基线里有 ${stale.length} 条已经查不到了（说明它们被修好了，但基线没更新）：`);
    for (const k of stale) console.log(`  ${k}`);
    console.log('  ⇒ 请删掉这些条目并重新登记（基线只许缩、不许涨）。');
  }
}

process.exit(fresh.length === 0 && stale.length === 0 ? 0 : 1);
