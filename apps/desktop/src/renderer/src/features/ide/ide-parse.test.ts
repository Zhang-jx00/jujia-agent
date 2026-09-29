import { describe, expect, it } from 'vitest';
import { isPdfPath, isTruncatedRead, parseListing, shouldRefuseSave } from './ide-parse';

/**
 * 轻量 IDE 的纯判断层（M19 报备 §六）。
 * 每条断言都对应一个"错了会静默出事"的现场：
 * 把标注当文件名 / 把截断内容当完整的保存 / 覆盖掉别人的改动 / 把 PDF 当文本读。
 */

describe('parseListing：认得出目录、认得出截断标注', () => {
  it('目录带尾斜杠，文件不带', () => {
    const r = parseListing('src/\nREADME.md\npackage.json');
    expect(r.entries).toEqual([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false },
      { name: 'package.json', isDir: false },
    ]);
    expect(r.note).toBeNull();
  });

  it('截断标注单独挑出来，**不当成一个文件名**', () => {
    const r = parseListing('a.txt\nb.txt\n（共 900 项，只显示了前 500 项）');
    expect(r.entries).toHaveLength(2);
    expect(r.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
    expect(r.note).toBe('（共 900 项，只显示了前 500 项）');
  });

  it('空目录的占位文本两边都不算：不是条目，也不是截断标注', () => {
    const r = parseListing('（空目录）');
    expect(r.entries).toEqual([]);
    expect(r.note).toBeNull();
  });
});

describe('isTruncatedRead：认得出"这份内容不完整"', () => {
  it('工具写的截断标注能被认出来', () => {
    expect(isTruncatedRead('正文……\n\n[已截断：文件共 900000 字节，只读取了前 262144 字节]')).toBe(true);
  });

  it('完整内容不会被误判', () => {
    expect(isTruncatedRead('普通文件内容\n第二行')).toBe(false);
  });
});

describe('isPdfPath：只认扩展名，大小写不敏感', () => {
  it('pdf / PDF 都算，别的都不算', () => {
    expect(isPdfPath('doc.pdf')).toBe(true);
    expect(isPdfPath('DOC.PDF')).toBe(true);
    expect(isPdfPath('a/b/c.PdF')).toBe(true);
    expect(isPdfPath('doc.pdf.txt')).toBe(false);
    expect(isPdfPath('pdf')).toBe(false);
  });
});

describe('shouldRefuseSave：覆盖保护', () => {
  it('盘上内容与打开时不一致 → 拒绝（这就是"别人改过了"）', () => {
    expect(shouldRefuseSave('原始内容', '被别人改过的内容')).toBe(true);
  });

  it('一致 → 放行（用户自己编辑后保存，盘上没变过）', () => {
    expect(shouldRefuseSave('同一份内容', '同一份内容')).toBe(false);
  });

  it('盘上文件被删掉（读回来是空/报错文案）也算变过', () => {
    expect(shouldRefuseSave('原始内容', '')).toBe(true);
  });
});
