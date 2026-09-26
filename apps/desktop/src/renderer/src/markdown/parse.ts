/**
 * Markdown 块级/行内解析（M10 收尾 · 应用内文档查看）。
 *
 * **为什么自己写而不引 `marked` / `markdown-it`**：这个渲染器要显示的是**第三方文件内容**
 * （工作区里的 .md，可能是别人给的、也可能是模型写出来的）。任何"输出 HTML 字符串再交给 DOM"
 * 的库，都要求我们再配一层 sanitize；而一旦哪天的调用点忘了 sanitize，被注入的就是**我们自己的渲染层**
 * —— 它手里有 `window.jujia`，能调全部 IPC 通道。这不是理论风险：M8/M4 反复处理的就是"授权边界"。
 *
 * 所以这里的产物是**结构**（Block / Inline 的联合类型），渲染层把它映射成 React 元素，
 * **全程没有 innerHTML**：XSS 防护是"构造上不可能"，而不是"记得转义"。
 *
 * 刻意**不支持**的东西（都在 UI 上如实说明，不假装支持）：
 * - 原始 HTML（按字面文本显示，绝不解释 —— 这是上面那条理由的直接后果）；
 * - 远程图片（不发起任何网络请求：看一篇本地文档不该顺带把访问记录交给第三方）；
 * - setext 标题（`===` / `---` 压在文字下面那种）。`---` 一律按分隔线处理，
 *   半支持只会让同一份文件在两个地方显示不一样；
 * - 脚注、任务列表复选框的交互（`- [ ]` 显示成方框符号，但不能点）。
 */

export type Inline =
  | { k: 'text'; v: string }
  | { k: 'code'; v: string }
  | { k: 'strong'; v: Inline[] }
  | { k: 'em'; v: Inline[] }
  | { k: 'strike'; v: Inline[] }
  | { k: 'link'; v: Inline[]; href: string }
  | { k: 'image'; alt: string; href: string };

export type Block =
  | { k: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; v: Inline[] }
  | { k: 'paragraph'; v: Inline[] }
  | { k: 'code'; lang: string | null; text: string }
  | { k: 'list'; ordered: boolean; items: Inline[][] }
  | { k: 'quote'; v: Inline[] }
  | { k: 'divider' }
  | { k: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { k: 'html'; text: string }
  | { k: 'frontmatter'; lines: number };

const FENCE = /^(`{3,}|~{3,})\s*([A-Za-z0-9_+.#-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
const QUOTE = /^\s*>\s?(.*)$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const HTML_LINE = /^\s*<(\/?[a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?\/?>\s*$/;

/** 行内解析里最长的安全扫描次数：畸形输入不该让页面卡死（宁可留下原文也不进入死循环） */
const MAX_INLINE_STEPS = 20_000;

/** 把 `- [ ]` / `- [x]` 的方框保留成可见符号（不能点：交互属于编辑器，不属于查看器） */
function taskMark(raw: string): string {
  const m = TASK.exec(raw);
  if (m === null) return '';
  return m[1] === ' ' ? '[ ] ' : '[✓] ';
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = src;
  let steps = 0;

  while (text !== '' && steps < MAX_INLINE_STEPS) {
    steps += 1;

    const code = /^`([^`\n]+)`/.exec(text);
    if (code !== null) {
      out.push({ k: 'code', v: code[1] ?? '' });
      text = text.slice(code[0].length);
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/.exec(text);
    if (image !== null) {
      out.push({ k: 'image', alt: image[1] ?? '', href: image[2] ?? '' });
      text = text.slice(image[0].length);
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/.exec(text);
    if (link !== null) {
      out.push({ k: 'link', v: parseInline(link[1] ?? ''), href: link[2] ?? '' });
      text = text.slice(link[0].length);
      continue;
    }

    const strong = /^\*\*([^*]+)\*\*|^__([^_]+)__/.exec(text);
    if (strong !== null) {
      out.push({ k: 'strong', v: parseInline(strong[1] ?? strong[2] ?? '') });
      text = text.slice(strong[0].length);
      continue;
    }

    const strike = /^~~([^~]+)~~/.exec(text);
    if (strike !== null) {
      out.push({ k: 'strike', v: parseInline(strike[1] ?? '') });
      text = text.slice(strike[0].length);
      continue;
    }

    const em = /^\*([^*\n]+)\*|^_([^_\n]+)_/.exec(text);
    if (em !== null) {
      out.push({ k: 'em', v: parseInline(em[1] ?? em[2] ?? '') });
      text = text.slice(em[0].length);
      continue;
    }

    /**
     * 普通字符：一次只吃一个，直到遇到下一个可能的标记。
     * `\\n` 这类转义按字面保留 —— 查看器不解释转义序列，避免把"看起来像换行"变成真换行。
     */
    const next = text.search(/[`![*_~]/);
    const take = next <= 0 ? 1 : Math.min(next, text.length);
    const last = out[out.length - 1];
    if (last !== undefined && last.k === 'text') last.v += text.slice(0, take);
    else out.push({ k: 'text', v: text.slice(0, take) });
    text = text.slice(take);
  }

  if (text !== '') out.push({ k: 'text', v: text });
  return out;
}

/** 表格行拆单元格：`| a | b |` → ['a','b']（首尾的空格由调用方 trim） */
function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  // front matter：文件第一行正好是 --- 时，找到下一个 --- 就整段折叠（AGENTS.md / NOTES.md 常见）
  if (lines[0]?.trim() === '---') {
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j]?.trim() === '---') {
        blocks.push({ k: 'frontmatter', lines: j - 1 });
        i = j + 1;
        break;
      }
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = (fence[1] ?? '`').charAt(0);
      const lang = (fence[2] ?? '') === '' ? null : (fence[2] ?? '');
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const closing = FENCE.exec(cur);
        if (closing !== null && (closing[1] ?? '`').charAt(0) === marker) {
          i += 1;
          break;
        }
        body.push(cur);
        i += 1;
      }
      blocks.push({ k: 'code', lang, text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = Math.min(Math.max((heading[1] ?? '#').length, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ k: 'heading', level, v: parseInline((heading[2] ?? '').trim()) });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ k: 'divider' });
      i += 1;
      continue;
    }

    if (HTML_LINE.test(line)) {
      // 单行标签：按字面显示，绝不解释成 DOM（见文件头那条理由）
      blocks.push({ k: 'html', text: line.trim() });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i] ?? '');
        if (m === null) break;
        buf.push(m[1] ?? '');
        i += 1;
      }
      blocks.push({ k: 'quote', v: parseInline(buf.join(' ').trim()) });
      continue;
    }

    const tableHeader = line.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '');
    if (tableHeader) {
      const header = cells(line).map((c) => parseInline(c));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(cells(lines[i] ?? '').map((c) => parseInline(c)));
        i += 1;
      }
      blocks.push({ k: 'table', header, rows });
      continue;
    }

    const ordered = OL.test(line);
    if (UL.test(line) || ordered) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const m = ordered ? OL.exec(cur) : UL.exec(cur);
        if (m === null) break;
        const raw = m[1] ?? '';
        const mark = taskMark(raw);
        const rest = TASK.test(raw) ? (TASK.exec(raw)?.[2] ?? '') : raw;
        items.push(parseInline(mark === '' ? rest : `${mark}${rest}`));
        i += 1;
      }
      blocks.push({ k: 'list', ordered, items });
      continue;
    }

    // 普通段落：吃到空行或遇到下一个块级起点为止
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (cur.trim() === '' || HEADING.test(cur) || HR.test(cur) || FENCE.test(cur) || QUOTE.test(cur) || UL.test(cur) || OL.test(cur)) break;
      para.push(cur.trim());
      i += 1;
    }
    blocks.push({ k: 'paragraph', v: parseInline(para.join(' ')) });
  }

  return blocks;
}

/** 这个链接能不能真的点开：只认 http/https（与主进程浏览器策略同一口径） */
export function isSafeLink(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
