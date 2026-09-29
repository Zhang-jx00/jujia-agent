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
    expect(() => decodeInlineAsset('不是 data URL')).toThrow();
    expect(() => decodeInlineAsset('data:application/octet-stream;base64')).toThrow();
  });
});

describe('内置资源清单：子集是有意挑的，不许悄悄变空', () => {
  it('16 个 CJK cmap + 14 个标准字体都在包里', () => {
    expect(BUNDLED_CMAP_COUNT).toBe(16);
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

  it('wasm 一类资源一律不提供（本应用不开 wasm，也不出网）', async () => {
    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' })).rejects.toThrow(/不提供/);
  });

  it('三个 URL 字段都是空的 —— 没有地址，就没有它自己去取的可能', () => {
    expect(factory.cMapUrl).toBeNull();
    expect(factory.standardFontDataUrl).toBeNull();
    expect(factory.wasmUrl).toBeNull();
  });
});
