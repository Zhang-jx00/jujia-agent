/**
 * 多模态输入的**纯规则层**（M11 批一 · R14 · 报备 `docs/DESIGN-MULTIMODAL.md` 四条已批）。
 *
 * 这一层站在"字节离开本机之前"，三条口径都是"错了会静默出事"的类型：
 * 1. **类型看魔数**：扩展名与声明都可以撒谎，只有容器头不会；
 * 2. **上界在剥离之前判**（剥离只减不增，按原始字节算最保守；5MB 的界要挡在
 *    "把字节读进来"之前 —— 落盘前的 `stat` 由调用方负责，这里再兜一道）；
 * 3. **剥不动就不发**（fail-closed）：带 GPS 的截图宁可拒绝并说明，
 *    也绝不"先发出去再说" —— 本仓对静默行为的一贯答案。
 *
 * 跨运行时纪律：这一层保持**零 Node 依赖**（不用 Buffer、不用 TextEncoder）——
 * 它只被主进程与发送侧消费，但"纯层在任何运行时里都能直接跑"本身就是它的单测方式；
 * `btoa/atob` 两边都有（Node ≥16 与浏览器），本包不带 DOM lib，
 * 类型在这里自己声明（同 canvas-graph 那六行 UTF-8 字节数的做法）。
 */

declare const btoa: (text: string) => string;
declare const atob: (text: string) => string;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** 单张大小上限：覆盖手机截图与常见照片；再大属于"原图直发烧 token"，批一不做 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 每条消息张数上限（报备 §三：够"多图对比"的常见用法，也给 token 与内存一个界） */
export const IMAGE_MAX_PER_MESSAGE = 4;

const ALLOWED: readonly ImageMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export interface PreparedImage {
  name: string;
  mimeType: ImageMime;
  /** 剥完元数据的字节（base64；发给模型时拼成 data URL） */
  dataBase64: string;
  /** 原始字节数（展示"多大一张"用原始值 —— 剥离只减不增） */
  sizeBytes: number;
  /** 是否真的剥掉了东西（gif 这类没有可剥容器 → false，如实说） */
  stripped: boolean;
}

export type PrepareResult = { ok: true; image: PreparedImage } | { ok: false; error: string };

/** 以魔数判定类型；认不出返回 null（不猜） */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const head = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    if (head === 'GIF8') return 'image/gif';
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    const webp = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return null;
}

/* ------------------------------ base64（跨运行时） ------------------------------ */

const CHUNK = 0x8000;

export function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function decodeBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/* ------------------------------ 元数据剥离 ------------------------------ */

type StripResult = { ok: true; out: Uint8Array; changed: boolean } | { ok: false; error: string };

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const four = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);

/**
 * JPEG：SOI 之后逐个标记段走；丢 APP1(EXIF/XMP)、APP13(Photoshop)、COM，
 * **保留 APP0(JFIF)**；遇到 SOS（0xDA）就把剩余字节原样带走（EXIF 不可能在压缩数据里）。
 * 长度字段不合法 = 结构坏了 → **拒绝**（不"跳过剩余照发"）。
 */
function stripJpeg(b: Uint8Array): StripResult {
  if (b.length < 4) return { ok: false, error: 'JPEG 头不完整' };
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let changed = false;
  while (i < b.length) {
    if (b[i] !== 0xff) return { ok: false, error: 'JPEG 结构无法解析（不是标记起始）' };
    const marker = b[i + 1]!;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      // 无载荷标记（TEM / RSTn / SOI）：两字节带走
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      // SOS / EOI：从这里开始整段原样（压缩数据 + 收尾）
      parts.push(b.subarray(i));
      break;
    }
    if (i + 4 > b.length) return { ok: false, error: 'JPEG 段头不完整' };
    const segLen = (b[i + 2]! << 8) | b[i + 3]!;
    const end = i + 2 + segLen;
    if (segLen < 2 || end > b.length) return { ok: false, error: 'JPEG 段长度不合法' };
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (drop) changed = true;
    else parts.push(b.subarray(i, end));
    i = end;
  }
  return { ok: true, out: concat(parts), changed };
}

/** PNG：丢 eXIf / tEXt / iTXt / zTXt 块；块结构坏 → 拒绝 */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);

function stripPng(b: Uint8Array): StripResult {
  if (b.length < 8) return { ok: false, error: 'PNG 头不完整' };
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let changed = false;
  while (i + 8 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const end = i + 12 + len;
    if (end > b.length) return { ok: false, error: 'PNG 块长度不合法' };
    const type = four(b, i + 4);
    if (PNG_DROP.has(type)) changed = true;
    else parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  if (i < b.length) parts.push(b.subarray(i)); // IEND 之后的尾巴原样
  return { ok: true, out: concat(parts), changed };
}

/** WebP：丢 EXIF / XMP 块；RIFF 长度字段**跟着修**（不是留着旧长度） */
const WEBP_DROP = new Set(['EXIF', 'XMP ']);

function stripWebp(b: Uint8Array): StripResult {
  if (b.length < 12) return { ok: false, error: 'WebP 头不完整' };
  const parts: Uint8Array[] = [b.subarray(0, 12)];
  let i = 12;
  let changed = false;
  while (i + 8 <= b.length) {
    const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    const pad = size % 2 === 1 ? 1 : 0;
    const end = i + 8 + size + pad;
    if (end > b.length) return { ok: false, error: 'WebP 块长度不合法' };
    const fourcc = four(b, i);
    if (WEBP_DROP.has(fourcc)) changed = true;
    else parts.push(b.subarray(i, end));
    i = end;
  }
  if (i < b.length) return { ok: false, error: 'WebP 尾部结构不合法' };
  const out = concat(parts);
  if (changed) {
    // RIFF 长度 = 总长 - 8（从 offset 4 起的小端 32 位），不修的话解码器可能读旧长度
    const size = out.length - 8;
    out[4] = size & 0xff;
    out[5] = (size >> 8) & 0xff;
    out[6] = (size >> 16) & 0xff;
    out[7] = (size >> 24) & 0xff;
  }
  return { ok: true, out, changed };
}

export function stripImageMetadata(
  bytes: Uint8Array,
  mime: ImageMime,
): { ok: true; out: Uint8Array; changed: boolean } | { ok: false; error: string } {
  switch (mime) {
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/png':
      return stripPng(bytes);
    case 'image/webp':
      return stripWebp(bytes);
    case 'image/gif':
      // GIF 没有本批要剥的容器元数据（注释块不在剥离清单里）—— 原样通过，如实标 stripped=false
      return { ok: true, out: bytes, changed: false };
  }
}

/* ------------------------------ 唯一入口 ------------------------------ */

/**
 * 校验 + 剥元数据 + 编码，**唯一的准入入口**（选择器 / 拖动 / 粘贴三条路共用；
 * 发送前还会被真正发信的那一侧再跑一遍 —— 渲染层给的字节永远不被信任）。
 */
export function prepareImage(input: { name: string; bytes: Uint8Array }): PrepareResult {
  const { name, bytes } = input;
  const mime = sniffImageMime(bytes);
  if (mime === null || !ALLOWED.includes(mime)) {
    return { ok: false, error: `「${name}」不是支持的图片（按文件内容识别；支持 png / jpeg / webp / gif）` };
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `「${name}」超过单张上限 5MB（现在 ${(bytes.length / 1024 / 1024).toFixed(1)}MB）`,
    };
  }
  const stripped = stripImageMetadata(bytes, mime);
  if (!stripped.ok) {
    return { ok: false, error: `「${name}」的元数据没能处理干净：${stripped.error} —— 这张图不会发出` };
  }
  return {
    ok: true,
    image: {
      name,
      mimeType: mime,
      dataBase64: encodeBase64(stripped.out),
      sizeBytes: bytes.length,
      stripped: stripped.changed,
    },
  };
}
