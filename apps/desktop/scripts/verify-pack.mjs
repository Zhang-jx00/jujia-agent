#!/usr/bin/env node
/* eslint-disable no-undef -- page.evaluate 的回调跑在浏览器上下文里 */
/**
 * **打包产物验证**（复核 042 的系统性建议、043 裁决②：排在 M9 之前）。
 *
 * 为什么必须有它：现有全部门禁跑的都是 `out/` 的开发产物 —— 而 M19b 踩到的那个坑
 * （渲染层打包后是 `file://` 页面、Chromium 不许它 `fetch` 本地文件）**只在打包产物里出现**。
 * 也就是说，"开发态全绿、发出去才坏"的那一类问题，在它之前没有任何门禁拦得住。
 *
 * 三步（刻意最小 —— 先有网，再谈织密）：
 *   ① 启动打包版（隔离数据目录，证明它真的跑得起来）；
 *   ② 开「文件」页签、展开工作区（证明打包清单里该有的都在，动态 import 的懒加载 chunk 也能从 asar 里取到）；
 *   ③ 打开一份**中文 PDF**：页数 + 内置 cmap 被取用 + 抽字得到「你好」+ **全程零出站** ——
 *      这正是 M19b 那个内联方案在"发出去"之后是否仍然成立的直接证据。
 *
 * 用法：`npm run verify:pack`（根目录）—— 它会先构建再打包（--dir，不出安装包），然后跑这里。
 * 退出码：0 = 通过；1 = 失败（打印失败在哪一步与当时的界面文本）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { buildCjkPdf } from './pdf-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXE = join(here, '..', 'release', 'win-unpacked', 'JujiaAgent.exe');

const STEPS = [];
const log = (t) => console.log(t);
const ok = (t) => log(`  ✅ ${t}`);
const step = (t) => {
  STEPS.push(t);
  log(`\n[${STEPS.length}] ${t}`);
};
const fail = (text, detail) => {
  console.error(`\n❌ ${text}`);
  if (detail !== undefined) console.error(String(detail).slice(0, 900));
  console.error(`\n已完成步骤：\n${STEPS.map((s) => '  - ' + s).join('\n')}`);
  process.exit(1);
};

if (!existsSync(EXE)) {
  fail(`没有找到打包产物：${EXE}\n请先跑 npm run dist:dir —— 这个门禁验的就是打包产物本身。`);
}

const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
const TMP = join(here, '..', '..', '..', '.tmp', `verify-pack-${RUN_ID}`);
const dataDir = join(TMP, 'data');
const wsDir = join(TMP, 'ws');
const profileDir = join(TMP, 'profile');
mkdirSync(dataDir, { recursive: true });
mkdirSync(wsDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });

const cjkPdf = 'verify-pack-cjk.pdf';
writeFileSync(join(wsDir, cjkPdf), buildCjkPdf(), 'utf8');
writeFileSync(join(wsDir, 'README.txt'), '打包产物验证用的工作区\n', 'utf8');
// 工作区只走配置文件（与 e2e 同一手法：界面上的目录选择器需要真人点）
writeFileSync(
  join(dataDir, 'config.json'),
  JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    data: { theme: 'dark', workspace: wsDir, appearance: { packId: 'default-dark', pack: null } },
  }),
  'utf8',
);

log(`打包产物：${EXE}`);
log(`临时数据目录：${dataDir}`);

let app;
try {
  step('启动**打包版**（真实安装产物，不是 out/ 里的开发产物）');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.JUJIA_DATA_BASE_DIR = dataDir;
  app = await electron.launch({
    executablePath: EXE,
    args: [`--user-data-dir=${profileDir}`],
    env,
  });
  const win = await app.firstWindow();
  await win.waitForSelector('body', { timeout: 30_000 });
  const body = async () => (await win.locator('body').innerText()).replace(/\s+/g, ' ');
  const text = await body();
  if (!text.includes('概览')) fail('打包版起来了，但界面不对（没看到标签栏）', text.slice(0, 600));
  if (!text.includes(dataDir.split(/[\\/]/).pop() ?? '不存在')) {
    fail('概览页没有显示临时数据目录 —— 隔离没生效，这个验证可能碰到了真实数据', text.slice(0, 600));
  }
  ok('打包版能启动，且数据目录是隔离的临时目录');

  step('开「文件」页签并展开工作区（懒加载 chunk 与路径守卫在打包后仍成立）');
  await win.locator('nav.app-tabs button', { hasText: '文件' }).first().click();
  const waitText = async (needle, ms = 15_000) => {
    try {
      await win.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout: ms });
      return true;
    } catch {
      return false;
    }
  };
  if ((await waitText(cjkPdf)) !== true) {
    fail('「文件」页签没有列出工作区里的文件（打包后树读不出来？）', (await body()).slice(0, 700));
  }
  ok('文件树读得到磁盘内容（懒加载与文件工具在打包产物里都成立）');

  step('打开中文 PDF：页数 + 内置 cmap 被取用 + 抽字「你好」+ 全程零出站');
  const outbound = [];
  let seen = 0;
  win.on('request', (req) => {
    seen += 1;
    const u = req.url();
    if (u.startsWith('http://') || u.startsWith('https://')) outbound.push(u);
  });
  const consoleLines = [];
  win.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  await win.locator('button', { hasText: cjkPdf }).first().click();
  if ((await waitText('第 1 / 1 页')) !== true) {
    fail('PDF 没有渲染出页数（pdfjs 在打包产物里没跑起来？）', (await body()).slice(0, 700));
  }
  let assets = '';
  let pageText = '';
  for (let i = 0; i < 32 && !(assets.includes('Adobe-GB1-UCS2.bcmap') && pageText.includes('你好')); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    assets = (await win.locator('.jj-pdf').first().getAttribute('data-pdf-assets')) ?? '';
    pageText = (await win.locator('.jj-pdf').first().getAttribute('data-pdf-text')) ?? '';
  }
  if (!assets.includes('Adobe-GB1-UCS2.bcmap')) {
    fail(`打包版没有取用内置的 Adobe-GB1-UCS2（实际：${assets || '（空）'}）`, consoleLines.slice(-8).join(' | '));
  }
  if (!pageText.includes('你好')) {
    fail(`打包版没有抽出「你好」（实际：${pageText || '（空）'}）`, consoleLines.slice(-8).join(' | '));
  }
  if (outbound.length > 0) {
    fail(`打包版打开 PDF 期间出现了**出站**请求（违反"数据不出本机"）：${outbound.join(' , ')}`);
  }
  ok(
    `打包版：内置 cmap 被取用（${assets}）、抽字得到 ${pageText}、零出站（本轮看到 ${String(seen)} 条本地请求）`,
  );

  step('干净退出');
  await app.close();
  app = undefined;
  ok('已退出');
  log('\nVERIFY-PACK OK：打包产物能启动、能读工作区、能看中文 PDF（不缺字、不出网）');
} catch (err) {
  fail('执行过程中抛异常', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
} finally {
  if (app !== undefined) await app.close().catch(() => undefined);
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    console.log(`（提示）本轮临时目录未能自动清理：${TMP} —— 交给 scripts/cleanup.py 处理`);
  }
}
