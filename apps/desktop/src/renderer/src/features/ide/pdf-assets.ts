/**
 * PDF 的内置资源（M19b，批复②"内联进包"）。
 *
 * 为什么是"内联进包"而不是"应用内相对路径 + cMapUrl"：渲染层在**打包后是 `file://` 页面**，
 * Chromium 不许它 `fetch` 本地文件 —— 指一个相对路径过去，开发态（vite dev server，http）能用、
 * 打包后就取不到，那正是"开发看着好好的、发出去就缺字"的经典形状。
 * 所以这里把子集**内联进构建产物**（Vite 的 `?inline` 会变成 data URL），
 * 再由下面的工厂按文件名喂给 pdfjs：**没有网络、没有新通道、没有自定义协议**。
 *
 * 子集是**有意挑的**（复核方要求"不要全套几百个文件"）：
 * - CJK 常用 cmap **43 个**：`Uni*` 16 个（横竖排 × UCS2/UTF16 × 四语种）
 *   + `Adobe-*` 整族 27 个（CID 集合映射 —— 端到端测试证明 pdfjs 对 CID 字体要的是这一族，见下）；
 * - 标准字体 14 个（Foxit 十个 + Liberation 四个）—— pdfjs 只会按这些确切文件名来要。
 *   未打包的其它 cmap（日文旧编码、UTF32/UTF8 变体等）会**明确报错**而不是悄悄缺字。
 */

/* ---------------- CJK 常用 CMap（16 个） ---------------- */
import uniGbUcs2H from 'pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap?inline';
import uniGbUcs2V from 'pdfjs-dist/cmaps/UniGB-UCS2-V.bcmap?inline';
import uniGbUtf16H from 'pdfjs-dist/cmaps/UniGB-UTF16-H.bcmap?inline';
import uniGbUtf16V from 'pdfjs-dist/cmaps/UniGB-UTF16-V.bcmap?inline';
import uniCnsUcs2H from 'pdfjs-dist/cmaps/UniCNS-UCS2-H.bcmap?inline';
import uniCnsUcs2V from 'pdfjs-dist/cmaps/UniCNS-UCS2-V.bcmap?inline';
import uniCnsUtf16H from 'pdfjs-dist/cmaps/UniCNS-UTF16-H.bcmap?inline';
import uniCnsUtf16V from 'pdfjs-dist/cmaps/UniCNS-UTF16-V.bcmap?inline';
import uniJisUcs2H from 'pdfjs-dist/cmaps/UniJIS-UCS2-H.bcmap?inline';
import uniJisUcs2V from 'pdfjs-dist/cmaps/UniJIS-UCS2-V.bcmap?inline';
import uniJisUtf16H from 'pdfjs-dist/cmaps/UniJIS-UTF16-H.bcmap?inline';
import uniJisUtf16V from 'pdfjs-dist/cmaps/UniJIS-UTF16-V.bcmap?inline';
import uniKsUcs2H from 'pdfjs-dist/cmaps/UniKS-UCS2-H.bcmap?inline';
import uniKsUcs2V from 'pdfjs-dist/cmaps/UniKS-UCS2-V.bcmap?inline';
import uniKsUtf16H from 'pdfjs-dist/cmaps/UniKS-UTF16-H.bcmap?inline';
import uniKsUtf16V from 'pdfjs-dist/cmaps/UniKS-UTF16-V.bcmap?inline';

/* ---------------- Adobe CID 集合 CMap（27 个） ----------------
 *
 * 这一族是**端到端测试逼出来的**（M19b 复核③要求的那份中文 fixture）：
 * 一份 `/CIDSystemInfo (Adobe) (GB1) 2` 的 CID 字体，pdfjs 来要的是 **`Adobe-GB1-UCS2.bcmap`**，
 * 而不是 `UniGB-UCS2-H.bcmap` —— 只打包 Uni* 那一族的后果是"真实的中文 PDF 依旧缺字"，
 * 而单测（按名取字节）根本看不出来。整族 27 个文件才 ~145KB，索性全打包（含各家 `-0..6` 版本表）。
 */
import adobeCns1_0 from 'pdfjs-dist/cmaps/Adobe-CNS1-0.bcmap?inline';
import adobeCns1_1 from 'pdfjs-dist/cmaps/Adobe-CNS1-1.bcmap?inline';
import adobeCns1_2 from 'pdfjs-dist/cmaps/Adobe-CNS1-2.bcmap?inline';
import adobeCns1_3 from 'pdfjs-dist/cmaps/Adobe-CNS1-3.bcmap?inline';
import adobeCns1_4 from 'pdfjs-dist/cmaps/Adobe-CNS1-4.bcmap?inline';
import adobeCns1_5 from 'pdfjs-dist/cmaps/Adobe-CNS1-5.bcmap?inline';
import adobeCns1_6 from 'pdfjs-dist/cmaps/Adobe-CNS1-6.bcmap?inline';
import adobeCns1Ucs2 from 'pdfjs-dist/cmaps/Adobe-CNS1-UCS2.bcmap?inline';
import adobeGb1_0 from 'pdfjs-dist/cmaps/Adobe-GB1-0.bcmap?inline';
import adobeGb1_1 from 'pdfjs-dist/cmaps/Adobe-GB1-1.bcmap?inline';
import adobeGb1_2 from 'pdfjs-dist/cmaps/Adobe-GB1-2.bcmap?inline';
import adobeGb1_3 from 'pdfjs-dist/cmaps/Adobe-GB1-3.bcmap?inline';
import adobeGb1_4 from 'pdfjs-dist/cmaps/Adobe-GB1-4.bcmap?inline';
import adobeGb1_5 from 'pdfjs-dist/cmaps/Adobe-GB1-5.bcmap?inline';
import adobeGb1Ucs2 from 'pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap?inline';
import adobeJapan1_0 from 'pdfjs-dist/cmaps/Adobe-Japan1-0.bcmap?inline';
import adobeJapan1_1 from 'pdfjs-dist/cmaps/Adobe-Japan1-1.bcmap?inline';
import adobeJapan1_2 from 'pdfjs-dist/cmaps/Adobe-Japan1-2.bcmap?inline';
import adobeJapan1_3 from 'pdfjs-dist/cmaps/Adobe-Japan1-3.bcmap?inline';
import adobeJapan1_4 from 'pdfjs-dist/cmaps/Adobe-Japan1-4.bcmap?inline';
import adobeJapan1_5 from 'pdfjs-dist/cmaps/Adobe-Japan1-5.bcmap?inline';
import adobeJapan1_6 from 'pdfjs-dist/cmaps/Adobe-Japan1-6.bcmap?inline';
import adobeJapan1Ucs2 from 'pdfjs-dist/cmaps/Adobe-Japan1-UCS2.bcmap?inline';
import adobeKorea1_0 from 'pdfjs-dist/cmaps/Adobe-Korea1-0.bcmap?inline';
import adobeKorea1_1 from 'pdfjs-dist/cmaps/Adobe-Korea1-1.bcmap?inline';
import adobeKorea1_2 from 'pdfjs-dist/cmaps/Adobe-Korea1-2.bcmap?inline';
import adobeKorea1Ucs2 from 'pdfjs-dist/cmaps/Adobe-Korea1-UCS2.bcmap?inline';

/* ---------------- 标准字体（14 个，pdfjs 按确切文件名来要） ---------------- */
import foxitDingbats from 'pdfjs-dist/standard_fonts/FoxitDingbats.pfb?inline';
import foxitFixed from 'pdfjs-dist/standard_fonts/FoxitFixed.pfb?inline';
import foxitFixedBold from 'pdfjs-dist/standard_fonts/FoxitFixedBold.pfb?inline';
import foxitFixedBoldItalic from 'pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb?inline';
import foxitFixedItalic from 'pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb?inline';
import foxitSerif from 'pdfjs-dist/standard_fonts/FoxitSerif.pfb?inline';
import foxitSerifBold from 'pdfjs-dist/standard_fonts/FoxitSerifBold.pfb?inline';
import foxitSerifBoldItalic from 'pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb?inline';
import foxitSerifItalic from 'pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb?inline';
import foxitSymbol from 'pdfjs-dist/standard_fonts/FoxitSymbol.pfb?inline';
import liberationSansBold from 'pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?inline';
import liberationSansBoldItalic from 'pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf?inline';
import liberationSansItalic from 'pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf?inline';
import liberationSansRegular from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?inline';

/** 文件名 → data URL（名字就是 pdfjs 会来要的那个名字） */
const CMAPS: Readonly<Record<string, string>> = {
  'UniGB-UCS2-H.bcmap': uniGbUcs2H,
  'UniGB-UCS2-V.bcmap': uniGbUcs2V,
  'UniGB-UTF16-H.bcmap': uniGbUtf16H,
  'UniGB-UTF16-V.bcmap': uniGbUtf16V,
  'UniCNS-UCS2-H.bcmap': uniCnsUcs2H,
  'UniCNS-UCS2-V.bcmap': uniCnsUcs2V,
  'UniCNS-UTF16-H.bcmap': uniCnsUtf16H,
  'UniCNS-UTF16-V.bcmap': uniCnsUtf16V,
  'UniJIS-UCS2-H.bcmap': uniJisUcs2H,
  'UniJIS-UCS2-V.bcmap': uniJisUcs2V,
  'UniJIS-UTF16-H.bcmap': uniJisUtf16H,
  'UniJIS-UTF16-V.bcmap': uniJisUtf16V,
  'UniKS-UCS2-H.bcmap': uniKsUcs2H,
  'UniKS-UCS2-V.bcmap': uniKsUcs2V,
  'UniKS-UTF16-H.bcmap': uniKsUtf16H,
  'UniKS-UTF16-V.bcmap': uniKsUtf16V,
  'Adobe-CNS1-0.bcmap': adobeCns1_0,
  'Adobe-CNS1-1.bcmap': adobeCns1_1,
  'Adobe-CNS1-2.bcmap': adobeCns1_2,
  'Adobe-CNS1-3.bcmap': adobeCns1_3,
  'Adobe-CNS1-4.bcmap': adobeCns1_4,
  'Adobe-CNS1-5.bcmap': adobeCns1_5,
  'Adobe-CNS1-6.bcmap': adobeCns1_6,
  'Adobe-CNS1-UCS2.bcmap': adobeCns1Ucs2,
  'Adobe-GB1-0.bcmap': adobeGb1_0,
  'Adobe-GB1-1.bcmap': adobeGb1_1,
  'Adobe-GB1-2.bcmap': adobeGb1_2,
  'Adobe-GB1-3.bcmap': adobeGb1_3,
  'Adobe-GB1-4.bcmap': adobeGb1_4,
  'Adobe-GB1-5.bcmap': adobeGb1_5,
  'Adobe-GB1-UCS2.bcmap': adobeGb1Ucs2,
  'Adobe-Japan1-0.bcmap': adobeJapan1_0,
  'Adobe-Japan1-1.bcmap': adobeJapan1_1,
  'Adobe-Japan1-2.bcmap': adobeJapan1_2,
  'Adobe-Japan1-3.bcmap': adobeJapan1_3,
  'Adobe-Japan1-4.bcmap': adobeJapan1_4,
  'Adobe-Japan1-5.bcmap': adobeJapan1_5,
  'Adobe-Japan1-6.bcmap': adobeJapan1_6,
  'Adobe-Japan1-UCS2.bcmap': adobeJapan1Ucs2,
  'Adobe-Korea1-0.bcmap': adobeKorea1_0,
  'Adobe-Korea1-1.bcmap': adobeKorea1_1,
  'Adobe-Korea1-2.bcmap': adobeKorea1_2,
  'Adobe-Korea1-UCS2.bcmap': adobeKorea1Ucs2,
};

const STANDARD_FONTS: Readonly<Record<string, string>> = {
  'FoxitDingbats.pfb': foxitDingbats,
  'FoxitFixed.pfb': foxitFixed,
  'FoxitFixedBold.pfb': foxitFixedBold,
  'FoxitFixedBoldItalic.pfb': foxitFixedBoldItalic,
  'FoxitFixedItalic.pfb': foxitFixedItalic,
  'FoxitSerif.pfb': foxitSerif,
  'FoxitSerifBold.pfb': foxitSerifBold,
  'FoxitSerifBoldItalic.pfb': foxitSerifBoldItalic,
  'FoxitSerifItalic.pfb': foxitSerifItalic,
  'FoxitSymbol.pfb': foxitSymbol,
  'LiberationSans-Bold.ttf': liberationSansBold,
  'LiberationSans-BoldItalic.ttf': liberationSansBoldItalic,
  'LiberationSans-Italic.ttf': liberationSansItalic,
  'LiberationSans-Regular.ttf': liberationSansRegular,
};

/** 已打包的资源清单（给测试与文档用；也是"没打包的东西会报错"的那份名单） */
export const BUNDLED_CMAP_COUNT = Object.keys(CMAPS).length;
export const BUNDLED_FONT_COUNT = Object.keys(STANDARD_FONTS).length;

/**
 * data URL → 字节。
 * 认不出来的输入**直接抛**：喂给 pdfjs 一份空字节会变成"文档缺字但没人知道为什么"。
 */
export function decodeInlineAsset(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.startsWith('data:')) {
    throw new Error('内置资源不是 data URL，取不到字节（构建配置变动过？）');
  }
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * 给 pdfjs 的二进制资源工厂：形状对齐 `DOMBinaryDataFactory`（pdfjs 会 `new` 它，
 * 然后按 `{kind, filename}` 来要字节）。
 *
 * 三个 URL 字段**故意留空**：没有地址就没有"它自己去取"的可能 —— 取字节只有这一条路。
 */
export class BundledPdfBinaryDataFactory {
  readonly cMapUrl = null;
  readonly standardFontDataUrl = null;
  readonly wasmUrl = null;

  /**
   * 这一份文档**真的用到了哪些内置资源**（诊断用）。
   *
   * 为什么要有：内联 cmap 的意义就是"不缺字"，而"没缺字"这件事光看渲染结果很难证明
   * （缺字与画出空字形在像素上都可能很安静）。把"工厂被谁问过、答了没有"记下来，
   * 界面上以 `data-pdf-assets` 暴露给 e2e —— 于是"这份中文 PDF 真的取用了内置的 UniGB-UCS2-H"
   * 变成可断言的事实，而不是"我们相信它是这样"。
   */
  static served = new Set<string>();

  static resetServed(): void {
    BundledPdfBinaryDataFactory.served = new Set<string>();
  }

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const table = kind === 'cMapUrl' ? CMAPS : kind === 'standardFontDataUrl' ? STANDARD_FONTS : null;
    if (table === null) {
      throw new Error(`本应用不提供 ${kind} 资源（离线环境不取网）。`);
    }
    const url = table[filename];
    if (url === undefined) {
      // 明确报错，不静默缺字：用户至少能在控制台看到"缺的是哪一份"
      throw new Error(`这份 PDF 需要未内置的资源：${filename}（离线环境不取网；已内置 CJK 常用 cmap 与标准字体）`);
    }
    const bytes = decodeInlineAsset(url);
    BundledPdfBinaryDataFactory.served.add(filename);
    return bytes;
  }
}
