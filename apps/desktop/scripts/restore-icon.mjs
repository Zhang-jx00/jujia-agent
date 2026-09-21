/**
 * 恢复应用图标：从「盾牌+宝石」源图重新裁掉水印 → build/icon.png
 *
 * 为什么需要：第二版「俱佳极简笔画字标」的手工几何构造**未通过可读性检验**
 * （见 assets/icon/DESIGN-NOTES.md 的失败记录），不能作为品牌资产发布。
 * 这里回退到视觉上已经过人工核对的第一版图形，避免把不合格资产打进产物。
 *
 * 用法：node apps/desktop/scripts/restore-icon.mjs
 */
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ASSETS = join(decodeURIComponent(ROOT), 'assets', 'icon');
const OUT = join(decodeURIComponent(ROOT), 'apps', 'desktop', 'build', 'icon.png');
const SRC = join(ASSETS, 'source-generated.png');
const TRIM = 0.12;

const meta = await sharp(SRC).metadata();
const size = Math.min(meta.width ?? 0, meta.height ?? 0);
const keep = Math.round(size * (1 - TRIM));
const left = Math.round((size - keep) / 2);

const info = await sharp(SRC)
  .extract({ left, top: 0, width: keep, height: keep })
  .resize(1024, 1024, { fit: 'cover' })
  .png()
  .toFile(OUT);

await sharp(OUT).resize(256, 256).png().toFile(join(ASSETS, 'preview-256.png'));

console.log(`已恢复 build/icon.png（${info.width}×${info.height}，裁掉底部 ${Math.round(TRIM * 100)}% 水印区）`);
