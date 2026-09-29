import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * M19（轻量 IDE）的接线锁。
 *
 * 这一轮最容易出事的不是 UI，而是**接线**：
 * 保存绕开工具自己写盘、PDF 被做成给模型的工具、patch 又开一条通道 ——
 * 这三件事都能让全量单测与界面照样绿，而权限面已经变样了。
 */

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const pdfIpc = read('./ipc/pdf.ts');
const idePanel = read('../renderer/src/features/ide/IdePanel.tsx');
const gitPanel = read('../renderer/src/features/git/GitPanel.tsx');
const channels = read('../../../../packages/shared-ipc/src/channels.ts');

describe('PDF：只读、过守卫、有界', () => {
  it('路径守卫在真正读字节之前（越界连读都不该发生）', () => {
    expect(pdfIpc).toContain('await guardPath(');
    expect(pdfIpc.indexOf('await guardPath(')).toBeLessThan(pdfIpc.indexOf('await readFile('));
  });

  it('两条上限都在：文件大小与页数（超限一律明确拒绝）', () => {
    expect(pdfIpc).toContain('PDF_MAX_BYTES');
    expect(pdfIpc).toContain('st.size > PDF_MAX_BYTES');
    // 页数上限在渲染层判（那里才知道 numPages），但常量必须来自共享上限表
    expect(read('../renderer/src/features/ide/PdfView.tsx')).toContain('PDF_MAX_PAGES');
  });

  it('零出站是**配置**保证的：不设任何资源 URL，且 worker 不许走 fetch', () => {
    const view = read('../renderer/src/features/ide/PdfView.tsx');
    expect(view).toContain('useWorkerFetch: false');
    expect(view).toContain('useWasm: false');
    // 三个 URL 一个都不许出现：没有地址，就没有它去取的可能
    for (const opt of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
      expect(view).not.toContain(opt);
    }
  });

  it('PDF 没有被做成工具（不把"读任意二进制"变成模型的能力）', () => {
    expect(channels).toContain("PDF_OPEN: 'pdf:open'");
    expect(read('../../../../packages/agent-core/src/tools/registry.ts')).not.toContain('pdf');
  });
});

describe('保存：只有一条路，过工具那扇门', () => {
  it('IDE 面板不自己碰文件系统，写盘一律走 TOOL_RUN 的 write_file', () => {
    expect(idePanel).not.toContain("from 'node:fs");
    expect(idePanel).not.toContain('writeFileSync');
    expect(idePanel).toContain("toolRun('write_file'");
    expect(idePanel).toContain("toolRun('read_file'");
  });

  it('覆盖保护在读盘之后、写盘之前（顺序反了等于没保护）', () => {
    const at = idePanel.indexOf('shouldRefuseSave(');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(idePanel.indexOf("toolRun('write_file'"));
  });
});

describe('逐行 patch：复用读侧，不新开通道', () => {
  it('Git 面板走的是 gitDiff 的 patch 模式', () => {
    expect(gitPanel).toContain("{ mode: 'patch', path }");
  });

  it('通道表里没有第二条 diff 通道（同一件事不要两个入口）', () => {
    const gitChannels = [...channels.matchAll(/GIT_[A-Z_]+:/g)].map((m) => m[0]);
    expect(gitChannels.sort()).toEqual([
      'GIT_COMMIT:',
      'GIT_DIFF:',
      'GIT_LOG:',
      'GIT_STAGE:',
      'GIT_STATUS:',
      'GIT_UNSTAGE:',
    ]);
  });
});
