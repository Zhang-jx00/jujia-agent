import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PER_MESSAGE,
  prepareImage,
  type PreparedImage,
} from '@jujia/agent-core';

/**
 * 图片接收层（M11 批一 · R14）：**选择器**（给路径）与**拖动/粘贴**（给原始字节）两条路，
 * 共用同一个准入内核（`agent-core/media/image-prep.ts`）—— 校验、上限、剥元数据只有一份实现。
 *
 * 两条与"静默"有关的纪律：
 * 1. **上限挡在读盘之前**：`stat` 先判 5MB，再把字节读进来；
 * 2. **逐张给结果、超量明说**：好的进 `images`、坏的带理由进 `problems`，
 *    一次给超过 4 张不是"丢掉多的"，而是"多的这几张没进来，以及为什么"。
 *
 * 拖动/粘贴走的是**原始字节**而不是 base64：结构化克隆把 `Uint8Array` 原样送到主进程，
 * 渲染层不需要自己编码一道（少一道编码就少一处"编码器在网页环境里不可用"的暗礁）。
 */

export interface ImageIntakeResult {
  images: PreparedImage[];
  problems: string[];
}

export async function readImageFiles(paths: string[]): Promise<ImageIntakeResult> {
  const images: PreparedImage[] = [];
  const problems: string[] = [];
  const accepted = paths.slice(0, IMAGE_MAX_PER_MESSAGE);
  for (const extra of paths.slice(IMAGE_MAX_PER_MESSAGE)) {
    problems.push(`「${basename(extra)}」没有加入：一条消息最多 ${String(IMAGE_MAX_PER_MESSAGE)} 张`);
  }
  for (const path of accepted) {
    const name = basename(path);
    // **先 stat 再读**：5MB 的界要挡在"把字节读进来"之前
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (err) {
      problems.push(`「${name}」读不到：${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (size > IMAGE_MAX_BYTES) {
      problems.push(`「${name}」超过单张上限 5MB（现在 ${(size / 1024 / 1024).toFixed(1)}MB）`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await readFile(path));
      const prepared = prepareImage({ name, bytes });
      if (prepared.ok) images.push(prepared.image);
      else problems.push(prepared.error);
    } catch (err) {
      problems.push(`「${name}」读取失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { images, problems };
}

export function prepareByteImages(items: Array<{ name: string; bytes: Uint8Array }>): ImageIntakeResult {
  const images: PreparedImage[] = [];
  const problems: string[] = [];
  const accepted = items.slice(0, IMAGE_MAX_PER_MESSAGE);
  for (const extra of items.slice(IMAGE_MAX_PER_MESSAGE)) {
    problems.push(`「${extra.name}」没有加入：一条消息最多 ${String(IMAGE_MAX_PER_MESSAGE)} 张`);
  }
  for (const item of accepted) {
    const prepared = prepareImage({ name: item.name, bytes: item.bytes });
    if (prepared.ok) images.push(prepared.image);
    else problems.push(prepared.error);
  }
  return { images, problems };
}
