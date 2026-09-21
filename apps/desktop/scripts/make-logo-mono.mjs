/**
 * 把用户提供的图形转成黑白单色 LOGO（形状与构图完全不变）
 *
 * 原理：源图已经是「**透明背景 + 不透明有色图形**」（四角 alpha=0，中心 alpha=255）。
 * 因此最忠实的单色化方式是 **只替换 RGB，原样保留 alpha 通道** —— 不做阈值化、
 * 不做重采样、不做矢量化，形状与构图一个像素都不会变。
 *
 * 自检：脚本会逐字节比对输出的 alpha 与输入 alpha，不一致就报错退出
 * （即"形状未变"这件事必须被机器验证，而不是靠我说）。
 *
 * 用法：node apps/desktop/scripts/make-logo-mono.mjs <源图路径>
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const SRC = process.argv[2] ?? 'C:/Users/张/Desktop/extracted_pattern.png';
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(decodeURIComponent(ROOT), 'assets', 'icon');

/** 只改 RGB、保留 alpha */
async function recolor(r, g, b, tag) {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    // out[i + 3] 保持原样 —— 这正是"形状不变"的关键
  }
  const buf = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  return { buf, info, tag };
}

function assertAlphaUnchanged(srcBuf, srcInfo, outBuf) {
  return sharp(outBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then((o) => {
    for (let i = 3; i < o.data.length; i += 4) {
      if (o.data[i] !== srcBuf[i]) {
        return { ok: false, at: i };
      }
    }
    return { ok: true, pixels: srcInfo.width * srcInfo.height };
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const srcRaw = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const variants = [
    { name: 'logo-mono-black.png', r: 0, g: 0, b: 0, desc: '黑色图形 + 透明底（**主用**）' },
    { name: 'logo-mono-white.png', r: 255, g: 255, b: 255, desc: '白色图形 + 透明底（深色底用）' },
  ];

  for (const v of variants) {
    const { buf } = await recolor(v.r, v.g, v.b, v.name);
    const check = await assertAlphaUnchanged(srcRaw.data, srcRaw.info, buf);
    if (!check.ok) {
      console.error(`✗ ${v.name}：alpha 在第 ${check.at} 字节处发生变化 —— 形状被改动了，已中止`);
      process.exit(1);
    }
    await sharp(buf).toFile(join(OUT, v.name));
    console.log(`✓ ${v.name}（alpha 与源图逐字节一致，${check.pixels} 像素）→ ${v.desc}`);
  }

  // 黑白稿（白底压平）与反相稿（黑底），便于文档与深色场景直接使用
  await sharp(join(OUT, 'logo-mono-black.png'))
    .flatten({ background: '#ffffff' })
    .toFile(join(OUT, 'logo-black-on-white.png'));
  await sharp(join(OUT, 'logo-mono-white.png'))
    .flatten({ background: '#000000' })
    .toFile(join(OUT, 'logo-white-on-black.png'));
  console.log('✓ logo-black-on-white.png / logo-white-on-black.png');

  // 源图也归档（保留原始配色与来源，便于日后追溯）
  await sharp(SRC).toFile(join(OUT, 'source-user-provided.png'));
  console.log('✓ source-user-provided.png（源图归档）');

  const m = await sharp(SRC).metadata();
  console.log(`\n尺寸保持源图原生 ${m.width}×${m.height}（未重采样）。`);
}

main().catch((err) => {
  console.error('失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
