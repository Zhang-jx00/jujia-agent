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
 * - CJK 常用 cmap 16 个（Uni{GB,CNS,JIS,KS}-{UCS2,UTF16}-{H,V}）—— 预定义 CMap 没有系统兜底，
 *   缺了就是缺字，所以这一块必须打包；
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
    return decodeInlineAsset(url);
  }
}
