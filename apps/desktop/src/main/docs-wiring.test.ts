import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 文档查看（M10 收尾 · Markdown）的接线锁。
 *
 * 为什么放主进程测试目录、却去扫渲染层源码：这个项目的"接线锁"就是**源码级不变量**的看门人
 * （`ipc-wiring` / `browser-wiring` / `git-wiring` 同一族）。这里要锁的三件事都是
 * "改动一行就悄悄破掉"的类型，普通单测抓不到：
 * ① 不出现 innerHTML —— 这是 XSS 防护"构造上不可能"的唯一保证；
 * ② 读文件只有 `read_file` 一个口径 —— 第二处读盘逻辑 = 第二套路径守卫；
 * ③ 文档里的链接点开必须走审批通道 —— 第三方文件内容不能变成"未经确认的外发动作"。
 *
 * 扫描前先剥注释（`ipc-wiring.test.ts` 里那条纪律，踩过两次坑）。
 */

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const read = (rel: string): string => stripComments(readFileSync(join(here, '..', 'renderer', 'src', rel), 'utf8'));

const parseSource = read('markdown/parse.ts');
const viewSource = read('markdown/MarkdownView.tsx');
const panelSource = read('features/docs/DocPanel.tsx');

describe('文档查看的安全底线（渲染第三方文件内容）', () => {
  it('三个文件里都不许出现把字符串当 HTML 塞进 DOM 的写法', () => {
    for (const [name, src] of [
      ['parse.ts', parseSource],
      ['MarkdownView.tsx', viewSource],
      ['DocPanel.tsx', panelSource],
    ] as const) {
      expect(src, name).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|document\.write|insertAdjacentHTML/);
    }
  });

  it('解析器的产物只有结构，没有任何"HTML 字符串"字段', () => {
    expect(parseSource).not.toMatch(/html:\s*['"`<]/);
    // 原始 HTML 一律落成 k='html' 的字面文本（渲染层再原样显示）
    expect(parseSource).toContain("k: 'html'");
  });

  it('行内解析有步数上限（畸形输入不能吃满主线程）', () => {
    expect(parseSource).toContain('MAX_INLINE_STEPS');
    expect(parseSource).toMatch(/while \(text !== '' && steps < MAX_INLINE_STEPS\)/);
  });

  it('链接先判协议再决定给不给点；不给点的分支只显示文本', () => {
    expect(viewSource).toContain('isSafeLink(node.href)');
    expect(viewSource).toContain('不提供跳转');
  });

  it('点开链接走审批通道，不留 window.open / location 这类绕过口子', () => {
    expect(viewSource).not.toMatch(/window\.open|location\.href|location\.assign/);
    expect(panelSource).toContain("browserOpenWith(href, 'system')");
  });

  it('读文件只有 read_file 一个口径（不自己开第二条读盘通道）', () => {
    expect(panelSource).toContain("toolRun('read_file'");
    expect(panelSource).not.toMatch(/TOOL_RUN|ipcRenderer|fetch\(/);
  });

  it('远程图片永不加载（红线：加载远端图片 = 出站请求，违反"数据默认不出本机"）', () => {
    // 结构性证据：渲染层里根本没有 img 元素可言
    expect(viewSource).not.toMatch(/<img|createElement\(['"]img|new Image\(/);
    expect(viewSource).toContain('未加载远程内容');
    // 注释里的红线声明也要在（防"顺手支持图片"时连理由一起删掉）—— 这条读原文，不剥注释
    const raw = readFileSync(join(here, '..', 'renderer', 'src', 'markdown', 'parse.ts'), 'utf8');
    expect(raw).toContain('永不加载');
    expect(raw).toMatch(/数据(默认)?不出本机/);
    // 界面上也要把这条讲给用户（红线 2：不支持集要可见，否则用户以为文档坏了）
    expect(panelSource).toContain('查看器边界');
    expect(panelSource).toContain('远程图片永不加载');
  });

  it('长文档分块挂载：渲染数量由 shown 控制，且页面上说明还剩多少', () => {
    expect(viewSource).toContain('blocks.slice(0, shown)');
    expect(panelSource).toContain('继续加载');
    expect(panelSource).toContain('全部展开');
  });

  it('大小上限如实写在界面上（不假装能看完任意大的文件）', () => {
    expect(panelSource).toContain('256KB');
    expect(panelSource).toContain('已截断');
  });
});

/**
 * T24：切页签不丢阅读位置（路径 / 分块进度 / 滚动偏移）。
 *
 * 与 `tab-state-wiring` 同一族理由：这条修复的"存活"靠的是**面板卸载之后还剩什么**，
 * 而那不在面板里，在 `doc-view-state` 这个模块里。写成源码锁才抓得住三种退回去的做法：
 * 把 state 放回组件（切走就没）、把内容也缓存起来（读到的是旧文件）、把位置写进配置文件（越界的新语义）。
 */
describe('T24：文档页的阅读状态', () => {
  const stateSource = read('features/docs/doc-view-state.ts');

  it('状态存在模块级 store 里，面板挂载时读、变化时写', () => {
    expect(panelSource).toContain('currentDocView()');
    expect(panelSource).toContain('rememberDocView(');
    // 记录三样东西：路径、分块进度、滚动偏移 —— 少一样就还是不丢不了那一样
    expect(panelSource).toMatch(/rememberDocView\(\{ path: target, shown: nextShown, scrollTop:/);
    expect(panelSource).toContain('rememberDocView({ shown })');
    expect(panelSource).toContain('rememberDocView({ scrollTop: e.currentTarget.scrollTop })');
  });

  it('恢复的是**路径**，内容回来时重新读（缓存内容会读到旧文件，那是另一种骗人）', () => {
    expect(panelSource).toContain("toolRun('read_file', { path: target })");
    expect(panelSource).not.toMatch(/setContent\(saved|contentCache|cache\.set\(/);
  });

  it('滚动偏移真的接到"应用"那一步（只记不恢复 = 记住了一半，等于没记）', () => {
    expect(panelSource).toContain('pendingScrollRef.current = resume?.scrollTop ?? null');
    // 应用的位置取自 store 里那个值，而不是重新读一次 DOM（DOM 这时还没渲染出来）
    expect(panelSource).toContain('el.scrollTop = top');
  });

  it('读不到就**忘掉记录**（否则每次挂载都撞同一个坏路径，错误还会越切越多）', () => {
    expect(panelSource).toContain('clearDocView()');
    expect((panelSource.match(/clearDocView\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 而且只尝试恢复一次
    expect(panelSource).toContain('restoredRef.current');
  });

  it('store 只在内存里：不落盘、不进 IPC、不碰配置文件', () => {
    expect(stateSource).not.toMatch(/writeFile|readFile|localStorage|sessionStorage|ipcRenderer|fetch\(/);
    expect(stateSource).toMatch(/let view: DocViewState \| null = null/);
  });

  it('恢复出来的数值都被收敛过（NaN 的 shown 会让"继续加载"永远不出现 = 看起来文档变短了）', () => {
    expect(stateSource).toContain('Number.isFinite');
    expect(stateSource).toContain('Math.floor');
  });
});
