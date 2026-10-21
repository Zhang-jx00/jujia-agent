import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IMAGE_MAX_BYTES,
  decodeBase64,
  generateImage,
  sniffImageMime,
  type ImageGenError,
  type ImageMime,
} from '@jujia/agent-core';
import type { MediaImageFailReason } from '@jujia/shared-ipc';
import { resolveConnection } from '../connections-store';
import { getDataRoot } from '../paths';

/**
 * 媒体生成 · 文生图（M11 剩余 · R51 · S1 · 选项 B：走当前连接 · 产物落本应用数据目录）。
 *
 * 这一层站着**三道门**，一道都不许省：
 * 1. **回程字节过魔数 + 上限**（`sniffImageMime` / `IMAGE_MAX_BYTES`）——
 *    ⚠️ **方向**：R14 那道门管的是**入站**（用户选进来的图）；本轮没有输入图片，
 *    要管的是**回程**（服务商发回来的字节）。扩展名与声明都可以撒谎，只有容器头不会。
 * 2. **只支持 `b64_json`**：服务商只回图片**链接** ⇒ 报错，**不去下载**那个 URL
 *    （那要主进程再发一次 GET，URL 由服务端给 ⇒ SSRF 面）。
 * 3. **原子落盘**（tmp → fsync → rename）：**不**用 `atomicWriteJson`（它只管 JSON，
 *    还要 `.bak` / `.corrupt-*` 那一套判定）。
 *
 * 三条**不**做的事（报备稿 §五-7 与口径 5）：
 * - **不进权限门**（生成不是工具调用；塞进权限门会把"我请你画张图"变成"每次都要点确认"）；
 * - **不进执行审计**（对话发送都不进那本账，生成同理）；
 * - **不新增审批弹窗**。
 *
 * **判定语义一字未改** —— 本文件只是**新增**了一条能力，没有碰任何既有判定。
 */

/** 产物落点（相对数据根）：本应用自己的数据目录，不占用户工作区、也不为它加一道门 */
export const IMAGE_GEN_DIR = 'generated-images';

export interface ImageGenArtifact {
  /** 绝对路径 */
  path: string;
  /** 原始字节数 */
  sizeBytes: number;
  /** 按魔数认出来的类型 */
  mimeType: ImageMime;
  /** 提示词回显（截断过） */
  prompt: string;
}

export interface ImageGenOutcome {
  ok: boolean;
  artifacts: ImageGenArtifact[];
  /** 失败分类；成功时为 null */
  reason: MediaImageFailReason | null;
  /** 人话（成功时是空串） */
  error: string;
}

const ok = (artifacts: ImageGenArtifact[]): ImageGenOutcome => ({
  ok: true,
  artifacts,
  reason: null,
  error: '',
});

const fail = (
  reason: MediaImageFailReason,
  error: string,
  /** 部分成功时**已经在盘上**的那些（回执不许说"一张都没有"而盘上有） */
  artifacts: ImageGenArtifact[] = [],
): ImageGenOutcome => ({
  ok: false,
  artifacts,
  reason,
  error,
});

/** 提示词回显的上限（字符）—— 回执是给人看的，不是日志 */
const PROMPT_ECHO_MAX = 200;

/** 一次最多几张（与契约层的 `MEDIA_IMAGE_MAX_COUNT` 同值，两处各守一侧） */
const MAX_COUNT = 4;

/** 扩展名按**认出来的类型**给（不是按服务商说的） */
const EXT_OF: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * 文件名：`gen-<时间戳>-<提示词指纹>-<序号>-<随机段>.<扩展名>`。
 *
 * 三段各有各的理由：
 * - **时间戳**：人一眼能看出是哪一次生成的；
 * - **提示词指纹**（sha256 前 8 位）：同名能对上"这张是那句提示词生成的"，又不把提示词写进文件名
 *   （文件名会出现在资源管理器、截图、日志里 —— 提示词不该跟着文件名走）；
 * - **随机段**：同一秒、同一条提示词的两次生成**不许互相覆盖**（覆盖 = 产物被悄悄吃掉）。
 *
 * 扩展名由**魔数判定出来的类型**决定（不是按服务商说的）。
 */
function artifactNameFor(prompt: string, index: number, mime: ImageMime): string {
  const now = new Date();
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const stamp =
    `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
  const fingerprint = createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 8);
  const rand = randomUUID().replace(/-/g, '').slice(0, 4);
  return `gen-${stamp}-${fingerprint}-${String(index + 1).padStart(2, '0')}-${rand}.${EXT_OF[mime]}`;
}

/**
 * 原子写：tmp → fsync → rename。
 *
 * 为什么自己写而不用 `atomicWriteJson`：那个函数是给 **JSON** 用的（带 `.bak` 备份与
 * `.corrupt-*` 隔离判定），而产物是**二进制**——套上去只会得到一个带 `.bak` 的二进制文件。
 *
 * `fsync` 在 rename 之前：保证「rename 成功但内容没落盘」这种丢数据不会发生。
 * 目录本身不 fsync（Windows 上也不便）—— 与 `atomicWriteJson` 的口径一致。
 */
async function writeBytesAtomically(dir: string, fileName: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, fileName);
  const tmp = join(dir, `.${fileName}.${String(process.pid)}.tmp`);
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync(); // 落盘：防止「rename 成功但内容丢失」
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  return target;
}

/**
 * base64 字符串长度 ⇒ 解码后字节数的上界。
 *
 * 用来在**解码之前**挡掉"服务商发回来一个 100MB 的 base64"——
 * 解码本身要把它整个读进内存，那道界必须挡在读之前（与 R14「上限挡在读盘之前」同一条纪律）。
 */
function maxBase64CharsFor(byteLimit: number): number {
  return Math.ceil(byteLimit / 3) * 4 + 4;
}

/** provider 的失败分类 → 界面的失败分类 + 人话 */
function explain(err: unknown): { reason: MediaImageFailReason; error: string } {
  const code = (err as { code?: unknown } | null)?.code;
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'unsupported':
      return { reason: 'unsupported', error: message };
    case 'url_only':
      return { reason: 'url_only', error: message };
    case 'timeout':
      return { reason: 'timeout', error: message };
    case 'network_error':
      return { reason: 'network_error', error: message };
    case 'http_error':
      return { reason: 'http_error', error: message };
    case 'bad_response':
      return { reason: 'bad_response', error: message };
    default:
      return { reason: 'bad_response', error: message };
  }
}

/**
 * 把**我们这把密钥的原文**从"要显示给用户的话"里去掉。
 *
 * 为什么还要这一层：共享的那张剔密表（`agent-core` 的 `maskSecrets`）按**形态**认出密钥
 * （长随机串、`Bearer xxx`、`"api_key": "…"`），但服务商回显密钥的形态不受我们控制
 * —— 比如 `"invalid key:sk-xxx"`（键名与值之间没有空格），那张表认不出来。
 * 而这一层**知道我们自己的密钥是什么** ⇒ 能精确地把那一段抹掉。
 *
 * 这是**新增**的一道，不改共享那张表的任何判定（那张表是审计与聊天的共用口径，动它影响面太大）。
 */
function redactOwnKey(message: string, apiKey: string): string {
  if (apiKey === '' || !message.includes(apiKey)) return message;
  return message.split(apiKey).join('***');
}

/**
 * 走**当前连接**生成一张（或几张）图。
 *
 * 流程：取连接（含明文密钥，**只在主进程**）→ 调 provider → 回程字节过魔数 + 5MB →
 * 原子落盘 → 回执（路径 / 大小 / 类型）。
 */
export async function generateImageForConnection(input: {
  connectionId: string;
  prompt: string;
  count?: number;
}): Promise<ImageGenOutcome> {
  const prompt = input.prompt.trim();
  if (prompt === '') return fail('bad_response', '提示词是空的，没有可发的东西');
  const count = Math.min(MAX_COUNT, Math.max(1, Math.trunc(input.count ?? 1)));

  // 取连接：这里拿到明文密钥 —— **只在这一行之后的几行里用，绝不外传**
  let baseUrl: string;
  let model: string;
  let apiKey: string;
  try {
    const resolved = await resolveConnection(input.connectionId);
    baseUrl = resolved.record.baseUrl;
    model = resolved.record.model;
    apiKey = resolved.apiKey;
  } catch (err) {
    return fail('no_connection', `这个连接用不了：${err instanceof Error ? err.message : String(err)}`);
  }

  let encoded: string[];
  try {
    encoded = await generateImage({ baseUrl, model, prompt, apiKey, count });
  } catch (err) {
    const explained = explain(err as ImageGenError);
    return fail(explained.reason, redactOwnKey(explained.error, apiKey));
  }

  const dir = join(getDataRoot(), IMAGE_GEN_DIR);
  const artifacts: ImageGenArtifact[] = [];
  const maxChars = maxBase64CharsFor(IMAGE_MAX_BYTES);

  /**
   * ① 先把**每一张**都验过（解码 / 上限 / 魔数），**验完再落盘**。
   *
   * 为什么分两趟：一张图不合格就 return 的话，前面几张**已经落盘**了 ——
   * 于是回执说"没有产物"、盘上却有文件 ⇒ **回执在骗人**。
   * 两趟之后，"失败 ⇒ 盘上什么都没有"是**真的**。
   */
  const prepared: { bytes: Uint8Array; mime: ImageMime }[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    const b64 = encoded[i] as string;
    // 上限：先按长度上界挡（在解码之前），再按真实字节数判一次
    if (b64.length > maxChars) {
      return fail(
        'too_large',
        `第 ${String(i + 1)} 张超过单张上限 5MB，已中止（一张都没有落盘）`,
      );
    }
    const bytes = decodeBase64(b64);
    if (bytes === null) {
      return fail('bad_response', `第 ${String(i + 1)} 张不是合法的图片数据（解码失败），一张都没有落盘`);
    }
    if (bytes.byteLength > IMAGE_MAX_BYTES) {
      return fail(
        'too_large',
        `第 ${String(i + 1)} 张超过单张上限 5MB（现在 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB），一张都没有落盘`,
      );
    }
    // 类型：看魔数，不信扩展名也不信服务商说的
    const mime = sniffImageMime(bytes);
    if (mime === null) {
      return fail('not_image', `第 ${String(i + 1)} 张的内容认不出是图片（按文件内容识别），一张都没有落盘`);
    }
    prepared.push({ bytes, mime });
  }

  // ② 全部验过 ⇒ 才落盘（原子写）
  for (let i = 0; i < prepared.length; i += 1) {
    const { bytes, mime } = prepared[i]!;
    const name = artifactNameFor(prompt, i, mime);
    try {
      const path = await writeBytesAtomically(dir, name, bytes);
      artifacts.push({
        path,
        sizeBytes: bytes.byteLength,
        mimeType: mime,
        prompt: prompt.slice(0, PROMPT_ECHO_MAX),
      });
    } catch (err) {
      // 写盘失败是**部分成功**：前面几张**真的在盘上** ⇒ 回执要把它们说出来（不许说"一张都没有"）
      return fail(
        'write_failed',
        `第 ${String(i + 1)} 张落盘失败：${err instanceof Error ? err.message : String(err)}（前面 ${String(artifacts.length)} 张已经在盘上）`,
        artifacts,
      );
    }
  }

  if (artifacts.length === 0) {
    return fail('bad_response', '这次没有拿到任何图片数据');
  }
  return ok(artifacts);
}
