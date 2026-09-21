/**
 * 「俱佳」极简笔画字标 —— 参数化生成器（W12 / 品牌）
 *
 * 设计依据（2026-09-21 联网核实，见 assets/icon/DESIGN-NOTES.md）：
 * - **保罗·兰德**：蒸馏（复杂→单一简单形式）· 本质形式（几何基元）· 网格系统
 * - **极简七原则**：简洁 / 负空间 / 限色（1–2 色、先黑白）/ 几何形 / 字标优先 / 可缩放（16px 检验）/ 不过时
 * - **汉字字标专门方法**：识别性优先（变形 ≤30%、2 秒辨认检验）· 几何化（横竖等宽、转角规整）·
 *   **主动删笔画**（简化次要/重复笔画）· 负空间当骨架（黑白反相检验）·
 *   重心略偏上（科技感挺拔）· **先定字重再画** · 灰度 20px 检验
 *
 * 具体决策：
 * - 两字**共享同一个偏旁「亻」**→ 天然的统一性；用同一组参数绘制，保证"同源"
 * - 「佳」的右半「圭」天生是**横竖几何**（1 竖 + 4 横）→ 极简笔画的最佳载体
 * - 「俱」的右半「具」做了**笔画减省**：目框内由 2 横减为 1 横，底部两点保留但缩小
 * - 横竖**两种厚度**（横细竖粗，符合汉字书写与光学平衡）
 * - 重心设在字高中线**略偏上**（约 46%）
 *
 * 用法：node apps/desktop/scripts/make-logo.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ASSETS = join(decodeURIComponent(ROOT), 'assets', 'icon');
const BUILD = join(decodeURIComponent(ROOT), 'apps', 'desktop', 'build');

// ---------------- 参数（改这里就能调字重/比例） ----------------
const P = {
  /** 单字方格边长 */
  cell: 100,
  /** 字间距 */
  gap: 26,
  /** 竖笔厚度（粗） */
  wV: 9,
  /** 横笔厚度（细） */
  wH: 7,
  /** 笔画端头与转角：统一小圆角，避免尖锐（几何化后的亲和感） */
  cap: 1.5,
  /** 颜色 */
  ink: '#4c8dff',
  tile: '#101820',
  /** 图标内边距比例（留白 = 兰德的"负空间是主动元素"） */
  tilePaddingRatio: 0.16,
  /** 圆角半径占图标边长比例 */
  tileRadiusRatio: 0.225,
};

const r = (x, y, w, h) => ({ x, y, w, h });

/** 把「矩形笔画」转成 SVG，统一小圆角 */
function strokeRects(rects) {
  return rects
    .map(
      (s) =>
        `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${P.cap}" ry="${P.cap}" fill="${P.ink}"/>`,
    )
    .join('\n');
}

/**
 * 单字骨架（在 100×100 方格内，重心偏上）。
 * 输出统一为「横矩形 / 竖矩形」，这样横竖厚度天然一致 —— 符合"先定字重再设计"。
 */
function glyphJu() {
  // 「俱」= 亻 + 具（具做了笔画减省：目框内 2 横 → 1 横）
  const wV = P.wV;
  const wH = P.wH;
  const c = P.cell;
  const s = [];
  // ---- 亻（撇 + 竖）----
  // 撇：用一段斜笔画——这里用两条短横错位模拟（保持"只用横竖"的极简体），
  // 这样两字的所有笔画都是横/竖，风格绝对统一
  s.push(r(24, 24, 16, wH)); // 撇的起笔横
  s.push(r(16, 34, 16, wH)); // 撇的收笔横（错位形成斜势）
  s.push(r(24, 24, wV, 56)); // 竖（贯通）
  // ---- 具 ----
  const L = 40; // 左边界
  const R = 88; // 右边界
  s.push(r(L, 20, R - L, wH)); // 目框上横
  s.push(r(L, 20, wV, 44)); // 目框左竖
  s.push(r(R - wV, 20, wV, 44)); // 目框右竖
  s.push(r(L, 56, R - L, wH)); // 目框内横（原为两横，这里减为一横）
  s.push(r(L, 64, wV, 8)); // 目框下横（短，收在框内）
  s.push(r(36, 72, 56, wH)); // 长横（具的第五笔）
  // 底部两点（八）：用两段小竖表示，缩小体量以维持负空间
  s.push(r(44, 82, wH, 12));
  s.push(r(74, 82, wH, 12));
  return s;
}

function glyphJia() {
  // 「佳」= 亻 + 圭（圭 = 1 竖 + 4 横，天然几何）
  const wV = P.wV;
  const wH = P.wH;
  const s = [];
  // ---- 亻：与「俱」完全同一参数（保证两字同源、可联想）----
  s.push(r(24, 24, 16, wH));
  s.push(r(16, 34, 16, wH));
  s.push(r(24, 24, wV, 56));
  // ---- 圭 ----
  const L = 38;
  const R = 90;
  const VX = 64 - wV / 2; // 中竖
  s.push(r(L, 20, R - L, wH)); // 第 1 横
  s.push(r(VX, 20, wV, 64)); // 中竖（贯穿两个土）
  s.push(r(L, 34, R - L, wH)); // 第 2 横
  s.push(r(L, 54, R - L, wH)); // 第 3 横
  s.push(r(L, 76, R - L, wH)); // 第 4 横
  // 圭的下横比上横略宽（汉字书写习惯：底横托住）
  s[3] = r(L - 4, 54, R - L + 8, wH);
  s[4] = r(L - 6, 76, R - L + 12, wH);
  return s;
}

/** 生成「俱佳」字标 SVG（透明底，仅着色笔画） */
function logoSvg(color = P.ink) {
  const ju = glyphJu();
  const jia = glyphJia();
  const cell = P.cell;
  const width = cell * 2 + P.gap;
  const height = cell;
  const ink = (rects) =>
    rects
      .map(
        (s) =>
          `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${P.cap}" ry="${P.cap}" fill="${color}"/>`,
      )
      .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>俱佳Agent 字标</title>
  <g>
${ink(ju)}
  </g>
  <g transform="translate(${cell + P.gap}, 0)">
${ink(jia)}
  </g>
</svg>
`;
}

/** 生成方形应用图标：圆角深色底 + 居中字标 */
function iconSvg(size = 1024) {
  const pad = Math.round(size * P.tilePaddingRatio);
  const radius = Math.round(size * P.tileRadiusRatio);
  const cell = P.cell;
  const wmW = cell * 2 + P.gap;
  const wmH = cell;
  const avail = size - pad * 2;
  const scale = Math.min(avail / wmW, avail / wmH);
  const w = wmW * scale;
  const h = wmH * scale;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const body = `<g transform="translate(${x}, ${y}) scale(${scale})">
    <g>
${glyphJu()
  .map((s) => `      <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${P.cap}" ry="${P.cap}" fill="#ffffff"/>`)
  .join('\n')}
    </g>
    <g transform="translate(${cell + P.gap}, 0)">
${glyphJia()
  .map((s) => `      <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${P.cap}" ry="${P.cap}" fill="#ffffff"/>`)
  .join('\n')}
    </g>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <title>俱佳Agent 应用图标</title>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${P.tile}"/>
${body}
</svg>
`;
}

async function main() {
  await mkdir(ASSETS, { recursive: true });
  await mkdir(BUILD, { recursive: true });

  // 1) 字标源文件（矢量，可编辑 —— 这是"产出物"，不是过程文件）
  await writeFile(join(ASSETS, 'logo.svg'), logoSvg(), 'utf8');
  await writeFile(join(ASSETS, 'icon.svg'), iconSvg(), 'utf8');
  // 单色版（黑白先验：能只用黑白立住，才算过关）
  await writeFile(join(ASSETS, 'logo-mono.svg'), logoSvg('#111111'), 'utf8');

  // 2) 位图：字标（透明底 / 深底各一）、图标、小尺寸检验图
  await sharp(Buffer.from(logoSvg())).resize(1024).png().toFile(join(ASSETS, 'logo-1024.png'));
  await sharp(Buffer.from(logoSvg('#111111'))).resize(512).png().toFile(join(ASSETS, 'logo-mono-512.png'));
  // 16px 检验（极简原则：16px 下分不清形状就是还不够极简）
  await sharp(Buffer.from(iconSvg(1024)))
    .resize(16, 16)
    .png()
    .toFile(join(ASSETS, 'check-16px.png'));
  await sharp(Buffer.from(iconSvg(1024))).resize(256, 256).png().toFile(join(ASSETS, 'preview-256.png'));

  // 3) 应用图标（打包用；electron-builder 会自行转 ico）
  await sharp(Buffer.from(iconSvg(1024))).png().toFile(join(BUILD, 'icon.png'));

  console.log('已生成：');
  for (const f of ['logo.svg', 'logo-mono.svg', 'icon.svg', 'logo-1024.png', 'logo-mono-512.png', 'check-16px.png', 'preview-256.png']) {
    console.log('  assets/icon/' + f);
  }
  console.log('  apps/desktop/build/icon.png');
}

main().catch((err) => {
  console.error('生成失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
