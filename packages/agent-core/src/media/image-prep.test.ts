import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PER_MESSAGE,
  decodeBase64,
  encodeBase64,
  prepareImage,
  sniffImageMime,
} from './image-prep';

/**
 * 多模态输入的**纯规则层**（M11 批一 · R14，报备 `docs/DESIGN-MULTIMODAL.md` 四条已批）。
 *
 * 这一层站在"字节离开本机之前"：**以魔数判类型**（扩展名可以撒谎）、
 * **上界限在读盘之后、剥离之前**（剥离只减不增，界按原始字节算最保守）、
 * **剥不掉就不发**（fail-closed —— 带 GPS 的截图宁可拒绝，也不"先发出去再说"）。
 */

/* ---------------- 夹具工厂（手工构造最小合法字节） ---------------- */

const crc32Dummy = (): Uint8Array => new Uint8Array([0, 0, 0, 0]);

/** 本包不带 DOM lib（TextEncoder 没有类型）：夹具全是 ASCII，六行自己编码 */
const utf8 = (s: string): Uint8Array => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  out.set(crc32Dummy(), 8 + payload.length);
  return out;
}

function png(options: { withText: boolean }): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', new Uint8Array(13));
  const idat = pngChunk('IDAT', new Uint8Array([1, 2, 3]));
  const iend = pngChunk('IEND', new Uint8Array(0));
  const parts = [sig, ihdr];
  if (options.withText) {
    const meta = utf8('Comment\0GPS 31.23,121.47');
    parts.push(pngChunk('tEXt', meta), pngChunk('eXIf', new Uint8Array([0x49, 0x49, 0x2a, 0x00])));
  }
  parts.push(idat, iend);
  return concat(parts);
}

function jpeg(options: { withExif: boolean }): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  // APP0/JFIF：**必须保留**（不是元数据）
  const jfif = utf8('JFIF\0\u0001\u0002');
  parts.push(segment(0xe0, jfif));
  if (options.withExif) {
    const exif = utf8('Exif\0\0GPS:31.23,121.47');
    parts.push(segment(0xe1, exif));
    parts.push(segment(0xfe, utf8('a comment')));
  }
  // SOS：之后是压缩数据，整段原样（EXIF 不可能出现在这里）
  const sosHead = new Uint8Array([0xff, 0xda, 0x00, 0x02]);
  parts.push(sosHead, new Uint8Array([9, 9, 9, 0xff, 0xd9]));
  return concat(parts);
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  const len = payload.length + 2;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

function webp(options: { withExif: boolean }): Uint8Array {
  const vp8 = riffChunk('VP8 ', new Uint8Array([1, 2, 3]));
  const parts = [vp8]; // 'WEBP' 由 riff() 统一写，这里只给块
  if (options.withExif) {
    parts.push(riffChunk('EXIF', utf8('GPS:31.23')));
  }
  return riff(parts);
}

function riffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const pad = payload.length % 2 === 1 ? 1 : 0;
  const out = new Uint8Array(8 + payload.length + pad);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) out[i] = fourcc.charCodeAt(i);
  view.setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function riff(chunks: Uint8Array[]): Uint8Array {
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length); // RIFF(4) + size(4) + WEBP(4) + body
  out.set(utf8('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, body.length + 4, true);
  out.set(utf8('WEBP'), 8);
  out.set(body, 12);
  return out;
}

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

const asText = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/* ---------------- 用例 ---------------- */

describe('魔数判定：类型看字节，不看扩展名', () => {
  it('四种白名单格式认得出来', () => {
    expect(sniffImageMime(png({ withText: false }))).toBe('image/png');
    expect(sniffImageMime(jpeg({ withExif: false }))).toBe('image/jpeg');
    expect(sniffImageMime(webp({ withExif: false }))).toBe('image/webp');
    expect(sniffImageMime(utf8('GIF89a....'))).toBe('image/gif');
  });

  it('文本 / 空 / 截断字节一律 null（不猜）', () => {
    expect(sniffImageMime(utf8('hello world'))).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
    expect(sniffImageMime(png({ withText: false }).subarray(0, 4))).toBeNull();
  });
});

describe('上限与准入（都在剥离之前判）', () => {
  it('超过 5MB 直接拒，理由写清楚', () => {
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0);
    const r = prepareImage({ name: 'huge.png', bytes: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('5MB');
  });

  it('扩展名撒谎没用：内容是文本就叫它不是图片（按魔数说话）', () => {
    const r = prepareImage({ name: 'fake.png', bytes: utf8('not an image') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('不是支持的图片');
  });

  it('每条消息的上限常量存在且为 4（唯一的来源）', () => {
    expect(IMAGE_MAX_PER_MESSAGE).toBe(4);
  });
});

describe('EXIF / 元数据剥离：剥不动就不发', () => {
  it('PNG：tEXt / eXIf 块被剥掉，像素数据块原样', () => {
    const r = prepareImage({ name: 'shot.png', bytes: png({ withText: true }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.stripped).toBe(true);
    const sent = decodeBase64(r.image.dataBase64);
    expect(sent).not.toBeNull();
    const text = asText(sent!);
    expect(text).not.toContain('GPS 31.23');
    expect(text).toContain('IHDR');
    expect(text).toContain('IDAT');
  });

  it('JPEG：APP1(EXIF) 与 COM 被剥掉，APP0(JFIF) 保留，SOS 之后原样', () => {
    const r = prepareImage({ name: 'photo.jpg', bytes: jpeg({ withExif: true }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.stripped).toBe(true);
    const text = asText(decodeBase64(r.image.dataBase64)!);
    expect(text).not.toContain('GPS:31.23');
    expect(text).not.toContain('a comment');
    expect(text).toContain('JFIF');
    expect(text.endsWith('\u0009\u0009\u0009\u00ff\u00d9')).toBe(true);
  });

  it('WebP：EXIF 块被剥掉且 RIFF 长度字段跟着修（不是留着旧长度）', () => {
    const r = prepareImage({ name: 'pic.webp', bytes: webp({ withExif: true }) });
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    const sent = decodeBase64(r.image.dataBase64)!;
    expect(asText(sent)).not.toContain('GPS:31.23');
    const riffSize = new DataView(sent.buffer, sent.byteOffset).getUint32(4, true);
    expect(riffSize).toBe(sent.length - 8);
  });

  it('GIF：没有可剥的容器元数据，原样通过（stripped=false，字节不动）', () => {
    const gif = utf8('GIF89a........');
    const r = prepareImage({ name: 'a.gif', bytes: gif });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.stripped).toBe(false);
    expect([...decodeBase64(r.image.dataBase64)!]).toEqual([...gif]);
  });

  it('结构坏掉的 PNG（声明块长超出字节数）→ **拒发**，不硬发', () => {
    const bad = png({ withText: false });
    // 把 IHDR 的长度字段改成一个荒谬值
    new DataView(bad.buffer).setUint32(8, 0x7fffffff);
    const r = prepareImage({ name: 'broken.png', bytes: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('元数据');
  });
});

describe('base64 往返（渲染层与主进程都在用，不带 Buffer/DOM 依赖）', () => {
  it('encode → decode 逐字节相等（含非 ASCII 字节）', () => {
    const bytes = new Uint8Array([0, 255, 128, 1, 2, 250, 66]);
    expect([...decodeBase64(encodeBase64(bytes))!]).toEqual([...bytes]);
  });

  it('坏 base64 返回 null（不抛）', () => {
    expect(decodeBase64('!!!not-base64!!!')).toBeNull();
  });
});
