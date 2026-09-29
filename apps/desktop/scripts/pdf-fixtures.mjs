/**
 * 两份 PDF fixture（e2e 与打包产物验证共用；**同一份 fixture 两处跑**，免得"开发能过、打包版过不了"）。
 *
 * 为什么要自己造而不是塞二进制样本进仓库：样本会跟着仓库变老、也没人知道它为什么是这个形状；
 * 生成器把"合法的 PDF 长什么样"（对象表 + xref 偏移 + trailer）写清楚，
 * 而且字节数是实测出来的（`Buffer.byteLength` 算偏移，不是数着字符猜）。
 */

/** 最小但合法的一页 PDF（Helvetica + 一行拉丁字） */
export function buildMinimalPdf() {
  const stream = 'BT /F1 14 Tf 20 100 Td (E2E PDF OK) Tj ET';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${String(Buffer.byteLength(stream))}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  return assemble(objs);
}

/**
 * 用 **CJK 预定义 CMap** 的中文 PDF（M19b 复核③要求的 fixture）。
 *
 * 形状：Type0 字体 + CIDFontType0 后代、`/Encoding /UniGB-UCS2-H` —— 也就是"字符串里的字节
 * 要经那份 CMap 才能变成字形"。**只有内置了对应的 CMap，这两个字才映射得出来**；
 * 少了它就是"缺字"（这正是内联 cmap 要解决的那件事，所以它能当反证）。
 * 文本 `<4F60597D>` 是"你好"的 UCS2 编码。
 */
export function buildCjkPdf() {
  const stream = 'BT /F1 48 Tf 20 100 Td <4F60597D> Tj ET';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${String(Buffer.byteLength(stream))}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type0/BaseFont/STSong-Light/Encoding/UniGB-UCS2-H/DescendantFonts[6 0 R]>>',
    '<</Type/Font/Subtype/CIDFontType0/BaseFont/STSong-Light/CIDSystemInfo<</Registry(Adobe)/Ordering(GB1)/Supplement 2>>/FontDescriptor 7 0 R/DW 1000>>',
    '<</Type/FontDescriptor/FontName/STSong-Light/Flags 4/FontBBox[0 -300 1000 900]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 700/StemV 58>>',
  ];
  return assemble(objs);
}

/** 对象表 + xref + trailer 的机械拼装（偏移按**字节**算，中文/多字节内容才不会错位） */
function assemble(objs) {
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objs.length; i += 1) {
    offsets.push(Buffer.byteLength(out));
    out += `${String(i + 1)} 0 obj\n${objs[i] ?? ''}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${String(objs.length + 1)}/Root 1 0 R>>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
  return out;
}
