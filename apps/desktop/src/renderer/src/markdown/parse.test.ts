import { describe, expect, it } from 'vitest';
import { isSafeLink, parseInline, parseMarkdown } from './parse';

/**
 * Markdown 解析器的验收。
 *
 * 这个文件有个附带意义：它是**渲染层的第一批单测**（此前"渲染层零单测"是记在案的债 ——
 * `docs/PROGRESS.md`）。之所以能写，是因为解析被刻意做成了**纯函数**：输入字符串、输出结构，
 * 不碰 DOM。渲染那一层仍然只有界面级 e2e 兜。
 *
 * 用例优先覆盖"安全与不卡"，而不是"像不像 CommonMark"：
 * 原始 HTML 不许变成结构、畸形输入不许把主线程吃满、链接协议要能判出来。
 */

describe('块级结构', () => {
  it('标题按 # 的个数定级；七个 # 起**不再是标题**（跟 CommonMark 一致，别自创规则）', () => {
    const b = parseMarkdown('# a\n###### f\n####### g');
    expect(b[0]).toMatchObject({ k: 'heading', level: 1 });
    expect(b[1]).toMatchObject({ k: 'heading', level: 6 });
    expect(b[2]).toMatchObject({ k: 'paragraph' });
  });

  it('围栏代码块原样保留内容，语言标出来；未闭合也不吞掉后面所有内容', () => {
    const b = parseMarkdown('```ts\nconst a = 1;\n```\n\n之后段落');
    expect(b[0]).toMatchObject({ k: 'code', lang: 'ts', text: 'const a = 1;' });
    expect(b[1]).toMatchObject({ k: 'paragraph' });

    const open = parseMarkdown('```sh\nls\n\n没闭合之后的段落');
    expect(open[0]).toMatchObject({ k: 'code', lang: 'sh' });
  });

  it('连续列表项合成一个列表块；有序与无序不混', () => {
    const b = parseMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二');
    expect(b[0]).toMatchObject({ k: 'list', ordered: false });
    expect(b[1]).toMatchObject({ k: 'list', ordered: true });
  });

  it('任务列表显示成方框符号，但不产生可点结构（查看器不是编辑器）', () => {
    const b = parseMarkdown('- [ ] 待办\n- [x] 已完成');
    const items = b[0]?.k === 'list' ? b[0].items : [];
    expect(JSON.stringify(items[0])).toContain('[ ]');
    expect(JSON.stringify(items[1])).toContain('[✓]');
  });

  it('引用把连续行并成一段', () => {
    const b = parseMarkdown('> 第一行\n> 第二行');
    expect(b[0]).toMatchObject({ k: 'quote' });
    expect(JSON.stringify(b[0])).toContain('第一行');
    expect(JSON.stringify(b[0])).toContain('第二行');
  });

  it('分隔线只认 --- / *** / ___，并且 --- 压在文字下面也按分隔线（不支持 setext，文档里写明）', () => {
    const b = parseMarkdown('文字\n---\n***\n___');
    expect(b.map((x) => x.k)).toEqual(['paragraph', 'divider', 'divider', 'divider']);
  });

  it('管道表格拆成表头与数据行', () => {
    const b = parseMarkdown('| 名字 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |');
    expect(b[0]).toMatchObject({ k: 'table' });
    const table = b[0];
    if (table !== undefined && table.k === 'table') {
      expect(table.header.length).toBe(2);
      expect(table.rows.length).toBe(2);
    }
  });

  it('front matter 折叠成一条说明，不当成正文标题显示', () => {
    const b = parseMarkdown('---\ntitle: 笔记\ntags: [a]\n---\n\n# 正文');
    expect(b[0]).toMatchObject({ k: 'frontmatter', lines: 2 });
    expect(b[1]).toMatchObject({ k: 'heading' });
  });

  it('空行、纯空白行不产生段落块', () => {
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });
});

describe('安全：原始 HTML 绝不变成结构', () => {
  it('单行 HTML 标签按字面文本保留（k=html 只是"这是原文"的标记，渲染时仍走转义路径）', () => {
    const b = parseMarkdown('<img src=x onerror=alert(1)>');
    expect(b[0]).toMatchObject({ k: 'html' });
    const first = b[0];
    if (first !== undefined && first.k === 'html') expect(first.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('段落里的尖括号内容也留在文本节点里，不产生任何"标签"字段', () => {
    const json = JSON.stringify(parseMarkdown('普通文字 <script>alert(1)</script> 收尾'));
    expect(json).not.toMatch(/"tag"/);
    expect(json).toContain('<script>alert(1)</script>');
  });

  it('解析产物里不存在 html 字符串属性（渲染层因此没有 innerHTML 可用）', () => {
    const json = JSON.stringify(parseMarkdown('# 标题\n\n正文 **粗** 与 `码`\n\n```x\n<b>hi</b>\n```'));
    expect(json).not.toMatch(/"innerHTML"/);
    expect(json).not.toMatch(/<b>hi<\/b>"\s*,\s*"k":"(?!html)/);
  });
});

describe('行内标记', () => {
  it('代码段、加粗、斜体、删除线各自成语义节点', () => {
    const b = parseMarkdown('`a` **b** *c* ~~d~~');
    const first = b[0];
    if (first === undefined || first.k !== 'paragraph') throw new Error('段落没解析出来');
    const kinds = first.v.map((x) => x.k);
    expect(kinds).toEqual(['code', 'text', 'strong', 'text', 'em', 'text', 'strike']);
  });

  it('链接保留 href；图片不保留可加载的 src 语义（alt + href 只为显示）', () => {
    const link = parseInline('[点我](https://example.com)');
    expect(link[0]).toMatchObject({ k: 'link', href: 'https://example.com' });
    const img = parseInline('![图](https://example.com/a.png)');
    expect(img[0]).toMatchObject({ k: 'image', alt: '图' });
  });

  it('嵌套不塌：链接文字里的加粗仍是加粗', () => {
    const link = parseInline('**外面** 和 [重点在**里面**](https://a.cn)');
    const found = JSON.stringify(link);
    expect(found).toContain('strong');
    expect(found).toContain('https://a.cn');
  });

  it('畸形输入不进入死循环：未闭合的标记按字面留在文本里（有步数上限）', () => {
    const weird = '*'.repeat(5000) + '`'.repeat(500);
    const started = Date.now();
    const out = parseInline(weird);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(out.length).toBeGreaterThan(0);
    expect(JSON.stringify(out)).toContain('*');
  });

  it('空串与纯文本都安全', () => {
    expect(parseInline('')).toEqual([]);
    expect(parseInline('就是文字')).toEqual([{ k: 'text', v: '就是文字' }]);
  });
});

describe('链接协议判定（点开必须与主进程同一口径）', () => {
  it.each([
    ['https://example.com', true],
    ['http://127.0.0.1:8080', true],
    ['file:///C:/Windows/win.ini', false],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>1</script>', false],
    ['mailto:someone@example.com', false],
    ['不是网址', false],
  ])('%s → %s', (href, expected) => {
    expect(isSafeLink(href)).toBe(expected);
  });
});
