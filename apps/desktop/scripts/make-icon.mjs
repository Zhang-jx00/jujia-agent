/**
 * 图标后处理：裁掉平台水印 → 生成应用图标（W12 收尾 / 开源就绪）
 *
 * 背景：AI 生成图带平台水印（右下角），不能直接当应用图标。
 * 做法：从四周**对称内缩**裁掉底部水印所在的条带，再缩放到 1024×1024，
 * 这样保持正方形、图形仍居中、圆角仍是圆角。
 *
 * 用法：node apps/desktop/scripts/make-icon.mjs
 */
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const BUILD = new URL('../build/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC_DIR = decodeURIComponent(BUILD);
const OUT_PNG = join(SRC_DIR, 'icon.png');
const ASSETS = join(SRC_DIR, '..', '..', '..', 'assets', 'icon');

/** 水印在底部约 9–10% 高度处；内缩 12% 确保裁净（正方形→同时左右内缩，保持图形居中） */
const TRIM_BOTTOM_RATIO = 0.12;

async function main() {
  const files = await readdir(SRC_DIR);
  // 取「圆角深色底」那张（第二轮生成），文件名含 A_single_modern
  const source = files
    .filter((f) => f.toLowerCase().endsWith('.png') && f !== 'icon.png')
    .sort()
    .find((f) => f.includes('A_single_modern'));
  if (!source) {
    console.error('未找到第二轮生成的源图，请检查 build/ 目录');
    process.exit(1);
  }
  const sourcePath = join(SRC_DIR, source);
  const meta = await sharp(sourcePath).metadata();
  const size = Math.min(meta.width ?? 0, meta.height ?? 0);
  if (size === 0) {
    console.error('读不到源图尺寸');
    process.exit(1);
  }

  const keep = Math.round(size * (1 - TRIM_BOTTOM_RATIO));
  const left = Math.round((size - keep) / 2);

  // 1) 裁掉底部水印条带（左右对称内缩以保持正方形）
  const trimmed = await sharp(sourcePath)
    .extract({ left, top: 0, width: keep, height: keep })
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toFile(OUT_PNG);

  console.log(`已生成 ${OUT_PNG}（${trimmed.width}×${trimmed.height}）`);
  console.log(`裁切参数：源 ${size}×${size} → 保留 ${keep}×${keep}，left=${left}`);

  // 2) 存档源图与尺寸样例，便于日后追溯（同时把源图移出 build/，避免被误打进产物）
  await mkdir(ASSETS, { recursive: true });
  await rename(sourcePath, join(ASSETS, 'source-generated.png'));
  const other = files.filter((f) => f.toLowerCase().endsWith('.png') && f !== 'icon.png' && f !== source);
  for (const f of other) {
    await rename(join(SRC_DIR, f), join(ASSETS, `source-alt-${f}`));
  }

  // 3) 生成一张 256 供人工核对（也是 electron-builder 要求的最小尺寸）
  await sharp(OUT_PNG).resize(256, 256).png().toFile(join(ASSETS, 'preview-256.png'));
  console.log('源图已归档到 assets/icon/，并生成 preview-256.png');
}

main().catch((err) => {
  console.error('图标处理失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
