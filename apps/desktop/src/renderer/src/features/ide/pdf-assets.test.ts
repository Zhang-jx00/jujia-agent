import { describe, expect, it } from 'vitest';
import {
  BUNDLED_CMAP_COUNT,
  BUNDLED_FONT_COUNT,
  BundledPdfBinaryDataFactory,
  decodeInlineAsset,
} from './pdf-assets';

/**
 * 内置 PDF 资源（M19b，批复②"内联进包"）。
 *
 * 这一组断言同时干两件事：
 * ① **证明子集真的在包里**（导入本身就成功；名字对不上会在这里就红，
 *    而不是等用户打开一份中文 PDF 时才发现缺字）；
 * ② 证明"没打包的东西会明确报错"—— 静默缺字是我们要防的那一类失败。
 */

const factory = new BundledPdfBinaryDataFactory();

describe('decodeInlineAsset：data URL → 字节', () => {
  it('能还原出原始字节', () => {
    // "PDF" 三个字符的 base64
    expect(Array.from(decodeInlineAsset('data:application/octet-stream;base64,UERG'))).toEqual([0x50, 0x44, 0x46]);
  });

  it('认不出来的输入直接抛（喂空字节给 pdfjs 会变成无声缺字）', () => {
    // 这一对用例是**变异 M67 逃逸之后补的**：原先只写 `toThrow()`，
    // 而 `atob('不是 data URL')` 自己也会抛 —— 守卫被删掉照样"通过"，断言等于没写。
    // 所以现在①断言**是我们那句话**抛的（消息里含 data URL），②再加一个"合法 base64 但不是 data URL"的输入
    // （`hello`：去掉守卫之后 atob 能解开，函数会**静默返回乱字节**）。
    expect(() => decodeInlineAsset('hello')).toThrow(/data URL/);
    expect(() => decodeInlineAsset('data:text/plain;base64')).toThrow(/data URL/);
    expect(() => decodeInlineAsset('不是 data URL')).toThrow(/data URL/);
  });
});

describe('内置资源清单：子集是有意挑的，不许悄悄变空', () => {
  it('43 个 CJK cmap（Uni* 16 + Adobe* 27）+ 14 个标准字体都在包里', () => {
    expect(BUNDLED_CMAP_COUNT).toBe(43);
    expect(BUNDLED_FONT_COUNT).toBe(14);
  });
});

describe('工厂：按文件名喂字节，缺哪份就报哪份', () => {
  it('CJK cmap 与标准字体都取得到，且是真字节（不是空数组）', async () => {
    const cmap = await factory.fetch({ kind: 'cMapUrl', filename: 'UniGB-UCS2-H.bcmap' });
    expect(cmap.length).toBeGreaterThan(1000);
    const font = await factory.fetch({ kind: 'standardFontDataUrl', filename: 'FoxitFixed.pfb' });
    expect(font.length).toBeGreaterThan(1000);
  });

  it('没打包的名字 → 抛错，且错误里点名是哪一份', async () => {
    await expect(factory.fetch({ kind: 'cMapUrl', filename: 'UniJIS-UTF32-H.bcmap' })).rejects.toThrow(
      /UniJIS-UTF32-H\.bcmap/,
    );
  });

  it('pdfjs 对 CID 字体实际要的那一族（Adobe-*-UCS2）也在包里', async () => {
    // 这条是端到端测试逼出来的：只打 Uni* 时，一份 Adobe-GB1 的 CID 字体照样缺字
    for (const name of [
      'Adobe-GB1-UCS2.bcmap',
      'Adobe-CNS1-UCS2.bcmap',
      'Adobe-Japan1-UCS2.bcmap',
      'Adobe-Korea1-UCS2.bcmap',
    ]) {
      const bytes = await factory.fetch({ kind: 'cMapUrl', filename: name });
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it('wasm 一类资源一律不提供（本应用不开 wasm，也不出网）', async () => {
    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' })).rejects.toThrow(/不提供/);
  });

  it('三个 URL 字段都是空的 —— 没有地址，就没有它自己去取的可能', () => {
    expect(factory.cMapUrl).toBeNull();
    expect(factory.standardFontDataUrl).toBeNull();
    expect(factory.wasmUrl).toBeNull();
  });

  /**
   * 取用记录（给 e2e 的 `data-pdf-assets` 用）。
   * 为什么这条要在单测里钉住：e2e 靠它证明"这份中文 PDF 真的取用了内置的 CJK cmap" ——
   * 记录本身错（记了没成功的、或者重置不掉），那条端到端证据就是假的。
   */
  it('取用记录只记**成功**的那些，且可以重置', async () => {
    BundledPdfBinaryDataFactory.resetServed();
    expect(BundledPdfBinaryDataFactory.served.size).toBe(0);

    await factory.fetch({ kind: 'cMapUrl', filename: 'UniGB-UCS2-H.bcmap' });
    expect([...BundledPdfBinaryDataFactory.served]).toEqual(['UniGB-UCS2-H.bcmap']);

    // 失败的那次不许留下记录（否则"取用过"这个说法就掺水了）
    await expect(factory.fetch({ kind: 'cMapUrl', filename: 'UniJIS-UTF32-H.bcmap' })).rejects.toThrow();
    expect([...BundledPdfBinaryDataFactory.served]).toEqual(['UniGB-UCS2-H.bcmap']);

    BundledPdfBinaryDataFactory.resetServed();
    expect(BundledPdfBinaryDataFactory.served.size).toBe(0);
  });
});
