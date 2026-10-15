#!/usr/bin/env node
/* eslint-disable no-undef -- page.evaluate 的回调跑在浏览器上下文里 */
/**
 * **打包产物验证**（复核 042 的系统性建议、043 裁决②：排在 M9 之前）。
 *
 * 为什么必须有它：现有全部门禁跑的都是 `out/` 的开发产物 —— 而 M19b 踩到的那个坑
 * （渲染层打包后是 `file://` 页面、Chromium 不许它 `fetch` 本地文件）**只在打包产物里出现**。
 * 也就是说，"开发态全绿、发出去才坏"的那一类问题，在它之前没有任何门禁拦得住。
 *
 * 五步（刻意最小 —— 先有网，再谈织密）：
 *   ① 启动打包版（隔离数据目录，证明它真的跑得起来）；
 *   ② 开「文件」页签、展开工作区（证明打包清单里该有的都在，动态 import 的懒加载 chunk 也能从 asar 里取到）；
 *   ③ 打开一份**中文 PDF**：页数 + 内置 cmap 被取用 + 抽字得到「你好」+ **全程零出站** ——
 *      这正是 M19b 那个内联方案在"发出去"之后是否仍然成立的直接证据。
 *   ④ 跑一张**画布**（R29 补的登记欠账，`LINKAGE-M9.md` §五）：React Flow 的懒加载 chunk、
 *      `CANVAS_*` 那几条通道、图文件从 asar 外的数据目录读写 —— 三样都属于"开发态看不出、装出去才坏"；
 *   ⑤ 起一个**内置终端**（R29 补的第二笔欠账，从 R28 挪来）：`node-pty` 的原生 `.node`
 *      必须落在 `app.asar.unpacked` 里才起得来，而它一旦起不来，界面上只是"点了没反应"。
 *
 * ④⑤ 都刻意只走"不需要外部服务"的那条路：画布用两个工具节点（不碰模型连接），
 * 终端只 echo 一个 marker（不碰任何网络）—— 门禁要的是"打包产物自身成立"，不是第三方可用性。
 *
 * 用法：`npm run verify:pack`（根目录）—— 它会先构建再打包（--dir，不出安装包），然后跑这里。
 * 退出码：0 = 通过；1 = 失败（打印失败在哪一步与当时的界面文本）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { buildCjkPdf } from './pdf-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * 产物目录可以用 `JUJIA_PACK_DIR` 换走（默认 `release/win-unpacked`）。
 *
 * 为什么留这个口子：`electron-builder` 解 Electron 运行时是"写 `win-unpacked.tmp` 再 rename"，
 * 而这条 rename 会被系统层面的东西挡住（2026-10-15 实测：`.tmp` 里的文件逐个可动，
 * **只有目录本身不能 rename/delete** ⇒ 有进程握着该目录句柄）。换目录**并不能绕开**
 * （新路径同样在 rename 处 EPERM），所以这个变量真正的用处是：
 * **让"验的是哪个产物"这句话由环境决定，而不是把默认路径当成唯一真相** ——
 * 例如并行跑两轮打包验证时各占一个目录，谁验的谁都印在退出信息里。
 */
const packDir = process.env.JUJIA_PACK_DIR ?? 'win-unpacked';
const EXE = join(here, '..', 'release', packDir, 'JujiaAgent.exe');
const STALE_TMP = join(here, '..', 'release', 'win-unpacked.tmp');

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
  // fail-fast 预检（与 e2e 那条同形）：**宁可不跑也不要把环境说成产品失败**
  if (existsSync(STALE_TMP)) {
    console.error(
      `\n❌ 没有找到可验证的打包产物：${EXE}\n` +
        `   而 ${STALE_TMP} 卡在原地 —— electron-builder 的 "解到 .tmp 再 rename 成正式目录" 这一步被系统挡了。\n` +
        '   实测取证（2026-10-15）：.tmp **里面的文件**逐个可读写重命名，只有**目录本身**不能 rename/delete\n' +
        '   ⇒ 有进程握着这个目录的句柄；换输出目录（--config.directories.output=release/r29）同样在 rename 处 EPERM。\n' +
        '   本机还有 3 个 crashpad_handler 进程以**当前用户看不到的身份**在跑（CIM 取不到路径与命令行），\n' +
        '   归属无法确认 ⇒ **不去结束它们**（拿别人机器上的不明进程赌一把，代价可能是别人正在跑的东西）。\n' +
        '   这条门禁因此**今天验不了**：正确处置是重启后重跑 npm run verify:pack，或在确认归属后由使用者释放该句柄。\n' +
        '   台账规矩：这种环境下跑不动的项目 **只能记"未能运行 + 原因"，不许记成绿**。',
    );
    process.exit(1);
  }
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

  step('跑一张画布：React Flow 的懒加载 chunk + CANVAS_* 通道 + 图文件读写，在打包产物里都成立');
  /**
   * 这一补的是 `LINKAGE-M9.md` §五 记的那条欠账（"画布未纳入 verify:pack"）。
   *
   * 为什么只能是打包级证据：开发态 `out/` 走的是同一份源码，而坏的地方恰恰是产物形态 ——
   * 懒加载 chunk 有没有进 asar、`CANVAS_*` 那几条通道在打包清单里注没注册、
   * 图文件的数据目录读写路径在装出去之后还对不对。这些在 e2e 里全是绿的。
   *
   * 图刻意只用**工具节点**：提示词节点要连模型，那属于"第三方服务可用"而不是"打包产物成立"，
   * 把它混进门禁会让这条红起来的原因永远说不清。
   */
  const canvasDir = join(dataDir, 'canvas');
  mkdirSync(canvasDir, { recursive: true });
  const packGraphId = `verify-pack-canvas-${RUN_ID}`;
  /**
   * 写在**第一次真跑**时被抓出来（R31 之前这条门禁因本机句柄问题从未跑到，这一步也就从没执行过）：
   * 图文件不是裸图对象，而是 `JsonStore` 的**信封**（`{ version, updatedAt, data }`，见下面那层注释）——
   * `canvas-store.list()` 走 `readEnvelope`，`data` 取不到就当这张图坏了、**不进列表**（也不删它）。
   * 于是脚本写完点「画布」页签，"运行这张图"照样在（那是按钮，不是列表项），
   * 而 `button[data-graph-id=…]` 永远等不到 —— **症状长得像"打包后 React Flow 的 chunk 没取到"**，
   * 真相是夹具不像真的（R10 那条纪律的同族：夹具一旦不像真的，红起来会指错方向）。
   */
  writeFileSync(
    join(canvasDir, `${packGraphId}.json`),
    JSON.stringify(
      {
        /**
         * 信封是 `{ version, updatedAt, data }` **三层**（与 `e2e-ui.mjs` 的 `writeGraph` 一字同形）。
         * 第一次真跑红了两回：先少写整个信封（`list()` 解不出 `data`，图根本不进列表），
         * 补上 `updatedAt`+`data` 之后又少写**信封自己的 `version`** ——
         * `list()` 只读 `updatedAt`/`data` 所以列表是好的，`load()` 走 `JsonStore` 才判"形状不合法"，
         * 于是症状是"列表里看得见、点开报字段不对"，看着像打包产物的问题，其实是夹具不像真的。
         */
        version: 1,
        updatedAt: new Date().toISOString(),
        data: {
          version: 1,
          connectionId: 'no-connection-needed-for-tools',
          nodes: [
            { id: 'a', kind: 'tool', x: 40, y: 40, config: { toolName: 'list_dir', argsText: '{"path":"."}' } },
            { id: 'b', kind: 'tool', x: 300, y: 40, config: { toolName: 'read_file', argsText: '{"path":"README.txt"}' } },
          ],
          edges: [{ id: 'e1', from: 'a', to: 'b' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  await win.locator('nav.app-tabs button', { hasText: '画布' }).first().click();
  if ((await waitText('运行这张图', 20_000)) !== true) {
    fail('画布页没渲染出来（React Flow 的懒加载 chunk 在打包产物里没取到？）', (await body()).slice(0, 700));
  }
  // 列表项没出现有两种原因，必须分得开：① 信封写错了（夹具的问题）② 打包后读不到那个目录（产物的问题）。
  // 所以先把磁盘真值取一遍：文件在、且能解出 data，才算"应用该看得见它"。
  const graphFileRaw = readFileSync(join(canvasDir, `${packGraphId}.json`), 'utf8');
  if (!graphFileRaw.includes('"data"')) {
    fail('脚本自己写的图文件没有 data 那一层（夹具不像真的，与打包产物无关）');
  }
  await win.locator(`button[data-graph-id="${packGraphId}"]`).first().click({ timeout: 20_000 });
  if ((await waitText(`已打开 ${packGraphId}`, 15_000)) !== true) {
    fail(
      '从磁盘打开那张两节点图失败（图文件的读取路径或信封格式在打包后不对？）',
      (await body()).slice(0, 700),
    );
  }
  const packNodes = await win.locator('[data-node-status]').count();
  if (packNodes !== 2) fail(`画布上应该有两个节点（实际 ${String(packNodes)} 个）`);
  await win.locator('button', { hasText: '运行这张图' }).first().click();
  if ((await waitText('跑完了', 40_000)) !== true) {
    fail('两节点链在打包版里没跑完', (await body()).slice(-900));
  }
  const packOkNodes = await win.locator('[data-node-status="ok"]').count();
  if (packOkNodes !== 2) {
    fail(`两个节点都该是 ok（实际 ${String(packOkNodes)} 个）—— 打包后工具节点被谁拦住了？`, (await body()).slice(-900));
  }
  // 工具节点的输出必须真的来自磁盘（read_file 读的是本脚本刚写进工作区的那行字）
  if (!(await body()).includes('打包产物验证用的工作区')) {
    fail('工具节点的输出没出现在回执里（那一步可能根本没跑）', (await body()).slice(-900));
  }
  ok('画布在打包产物里跑通：chunk 取到、通道在、图文件读写正常、两个工具节点都 ok 且输出来自磁盘');

  step('起一个内置终端：node-pty 的原生模块在 asar.unpacked 里，批准之后真起得来进程');
  /**
   * 这一补的是从 R28 挪来的欠账（§6.2 R29 行）。判据只要一件事：**界面里看得见子进程吐的字**。
   * 起不来的话界面只是"点了没反应"—— 而 `.node` 有没有被 asar 打包规则漏出去，
   * 开发态（`out/` + 顶层 node_modules）永远看不出来，只有装出去之后才暴露。
   */
  const ptyMarker = `PACK-PTY-${RUN_ID}`;
  await win.locator('nav.app-tabs button', { hasText: '终端' }).first().click();
  if ((await waitText('启动终端（新会话需审批）', 15_000)) !== true) {
    fail('终端页在打包版里没挂上', (await body()).slice(0, 700));
  }
  await win.locator('button', { hasText: '启动终端（新会话需审批）' }).first().click();
  if ((await waitText('启动终端会话', 15_000)) !== true) {
    fail('点启动没弹审批（终端能跑任意命令，新会话必须问过人手 —— 打包版也不该例外）', (await body()).slice(0, 700));
  }
  await win.locator('[role="dialog"][aria-label="权限请求"] button', { hasText: '允许一次' }).first().click();
  if ((await waitText('运行中', 20_000)) !== true) {
    fail(
      '批准之后终端没进入运行态 —— 十有八九是 node-pty 的原生模块没进 app.asar.unpacked（打包清单漏了它）',
      (await body()).slice(0, 900),
    );
  }
  await win.locator('.jj-terminal-host').first().click();
  await win.keyboard.type(`echo ${ptyMarker}`);
  await win.keyboard.press('Enter');
  if ((await waitText(ptyMarker, 20_000)) !== true) {
    fail(`终端起来了但 marker 没回来（子进程没真跑 / 输出没接到视图）：${ptyMarker}`, (await body()).slice(-900));
  }
  ok(`打包版终端真的跑起了一个 shell 并把输出接回了视图（marker ${ptyMarker} 已在屏幕上）`);

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
