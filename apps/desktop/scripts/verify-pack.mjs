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
 * 用法：`npm run verify:pack`（根目录）—— **打包这一步就在本脚本里**（T67 · R35）：
 * 构建 + `--dir` 打包到本轮专属的 `release/pack-<运行 id>/`，验完自己收走；
 * 不出安装包，也不再与任何人共用 `release/win-unpacked`。
 * 退出码：0 = 通过；1 = 失败（打印失败在哪一步与当时的界面文本）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { buildCjkPdf } from './pdf-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * **本轮自己独占的产物目录**（T67 · R35 落地）。两件事分开说，别混成一条：
 *
 * ① **为什么换成按运行命名的目录**：不再与任何一轮共用同一个目标目录，
 *    于是"这一轮验的是哪份产物"写在日志里就是事实，而不是"大概是当前那一份"；
 *    旧副本归下一轮扫掉，`release/` 不再无限堆积。
 * ② **这一步为什么会红**（R35 实测到的真因，**推翻我上一轮写的原因**）：
 *    `electron-builder` 解 Electron 运行时是"写 `win-unpacked.tmp` 再 rename 成正式目录"，
 *    而刚解压完的那段时间里**目录里的文件被本机短暂握着**（防病毒实时扫描 / 索引器一类），
 *    rename 当场 EPERM。两条证据：
 *    · 同一只 `win-unpacked.tmp` 过几分钟再改名**成功，耗时 2ms**（不是常驻句柄）；
 *    · 换到**全新**目录 `pack-probe1`（里面什么都没有）第一次跑**照样 EPERM**
 *      ⇒ 换目录不是药，**带等待的重试才是**。
 *    因此 R29 的"换目录也绕不开"与规整19 的"换目录一次成功"（我上一轮还把它写成
 *    "挡的就是覆盖那一步"）**两条都是撞运气**，本轮一并改口 —— 见复核 092。
 *
 * `JUJIA_PACK_DIR` 保留成人工口子，含义改窄：**设了它 = 只验这份现成产物、本轮不打包**。
 */
const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
const PACK_OUT = `pack-${RUN_ID}`;
const RELEASE_DIR = join(here, '..', 'release');
const manualDir = process.env.JUJIA_PACK_DIR;
const BUILD = manualDir === undefined || manualDir === '';
const packRel = BUILD ? join(PACK_OUT, 'win-unpacked') : manualDir;
const EXE = join(RELEASE_DIR, packRel, 'JujiaAgent.exe');
/** 本轮这一族的目录（收尾删它） */
const RUN_OUT_DIR = join(RELEASE_DIR, PACK_OUT);
/** 与产物目录同级的 `.tmp`：它卡在原地就是"被谁握着"的样子，预检要把这句话说明白 */
const STALE_TMP = join(dirname(join(RELEASE_DIR, packRel)), 'win-unpacked.tmp');

const STEPS = [];
/** 走完最后一步才算成功；退出码由它决定（`fail` 抛哨兵异常，收尾统一在 finally） */
let finished = false;
const log = (t) => console.log(t);
const ok = (t) => log(`  ✅ ${t}`);
const step = (t) => {
  STEPS.push(t);
  log(`\n[${STEPS.length}] ${t}`);
};
/**
 * 失败出口用**抛哨兵异常**，不用 `process.exit(1)`（T66 · 同族第四处，本轮顺着护栏第 25 条扫出来的）。
 *
 * 为什么这一处最要紧：这个脚本的 `finally` 负责**关掉它拉起来的打包版应用**并删临时目录。
 * 旧写法一 exit 就把 `finally` 跳过了 ⇒ 应用留在后台继续握着 `release/win-unpacked*` 的句柄 ⇒
 * **下一次 `dist:dir` 在 rename 那一步 EBUSY**。今天这条门禁跑不动（见下面的预检文案），
 * 与这个泄漏是同一条链上的事 —— 只说链存在，不把归因写死。
 */
class PackAbort extends Error {}

const fail = (text, detail) => {
  console.error(`\n❌ ${text}`);
  if (detail !== undefined) console.error(String(detail).slice(0, 900));
  console.error(`\n已完成步骤：\n${STEPS.map((s) => '  - ' + s).join('\n')}`);
  throw new PackAbort(text);
};

/**
 * 预检只在**人工指定产物目录**时做：默认路径下产物还没打出来，
 * 拿"EXE 在不在"当预检会把正常流程当成失败（这是 T67 改造时必须一起挪的一位）。
 */
if (!BUILD && !existsSync(EXE)) {
  // fail-fast（与 e2e 那条同形）：**宁可不跑也不要把环境说成产品失败**
  if (existsSync(STALE_TMP)) {
    console.error(
      `\n❌ 人工指定的产物目录里没有可验的 exe：${EXE}\n` +
        `   而同级还有 ${STALE_TMP} 卡在原地 —— electron-builder 的"解到 .tmp 再 rename 成正式目录"被系统挡了。\n` +
        '   实测取证（2026-10-15）：.tmp **里面的文件**逐个可读写重命名，只有**被握着的那一个**删不掉\n' +
        '   ⇒ 有进程握着它的句柄。同日也实测过 `--config.directories.output=release/shoot` **一次成功**，\n' +
        '   所以挡的一直是"改名覆盖到那个已被握着的目录"这一步 —— **全新目录不碰它**。\n' +
        '   这正是 T67（R35）的落点：默认路径下这条门禁现在自己打到 `release/pack-<运行 id>/`，\n' +
        '   别人的句柄再也挡不住它；只有人工指定一个现成产物时才会走到这条预检。\n' +
        '   归属不明的进程**照旧不杀**（拿别人机器上的不明进程赌一把，代价可能是别人正在跑的东西）。\n' +
        '   台账规矩：这种环境下跑不动的项**只能记"未能运行 + 原因"，不许记成绿**。\n' +
        '   （这里的 `process.exit(1)` 是安全的：走到这一行还没拉起应用、也没建临时目录，没有收尾要跑。）',
    );
    process.exit(1);
  }
  /**
   * 这里用 `process.exit(1)` 而不是 `fail()`：**此刻还没建临时目录、没拉起应用，没有收尾要跑**，
   * 而 `fail()` 抛的哨兵在 try 之外没人接 —— 会在终端甩一叠栈（本轮实测到就是这个样子）。
   */
  console.error(`❌ 没有找到要验的打包产物：${EXE}\n（JUJIA_PACK_DIR 指向的东西不在；不设这个变量则由本脚本自己打包。）`);
  process.exit(1);
}

/**
 * **自造产物的自我认领**：只扫 `release/pack-*` 这一族（自己命名的空间），
 * 别的一律不碰 —— `release/win-unpacked`、0.9.0 的安装包都不归这个脚本管。
 * 删不掉**不中止**：本轮写的是自己的新目录，旧的删不掉只是一条要在日志里说出来的残留。
 */
const sweepOldPackDirs = () => {
  if (!existsSync(RELEASE_DIR)) return;
  for (const name of readdirSync(RELEASE_DIR)) {
    if (!name.startsWith('pack-') || name === PACK_OUT) continue;
    try {
      rmSync(join(RELEASE_DIR, name), { recursive: true, force: true });
      log(`  （清场）删掉上一轮留下的 release/${name}/`);
    } catch (err) {
      log(
        `  （清场未成）release/${name}/ 删不掉：` +
          `${String(err instanceof Error ? err.message : err).slice(0, 140)}` +
          ' —— 本轮不挡路（我们写自己的新目录），但这条残留留在日志里，别把它说成已清理',
      );
    }
  }
};

const errorHits = (whole, max = 6) =>
  whole
    .split('\n')
    .filter((l) => /⨯|error|EPERM|EBUSY|rename/i.test(l))
    .slice(0, max)
    .join('\n');

/** 起子进程一律走 `process.execPath` + 入口 js（与本仓变异自检同一手法，绕开 .cmd 的 shell 依赖） */
const runBuild = (label, entry, args, cwd) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  if (r.status !== 0) {
    const whole = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
    // 病灶通常在**前几行**（`⨯ EPERM: ... rename ...`），尾部只剩一叠栈。
    // 上一版只交尾部，等于把自己挡在错误外面 —— 这次两头都给。
    fail(`${label} 失败（退出码 ${String(r.status)}，耗时 ${String(ms)}ms）`, `${errorHits(whole)}\n--- 尾部 ---\n${whole.slice(-700)}`);
  }
  log(`  ✅ ${label}（${String(ms)}ms）`);
};

/**
 * **打包这一步带等待重试**（R35 实测的真药）。
 *
 * 只认这一类失败：`EPERM / EBUSY / operation not permitted / resource busy` 且伴随 rename ——
 * 本机在解包后会短暂握着目录里的文件（防病毒实时扫描 / 索引器一类），等一会儿就松开
 * （证据：同一只 `.tmp` 几分钟后改名成功，耗时 2ms）。**其余失败一次就报**，
 * 不许用重试把真错误洗白 —— 静默重试三次的"红"会被读成"环境噪声"，那就又是 T65 那种没人修的洞。
 */
const BUILDER_TRIES = 4;
const BUILDER_WAITS = [5_000, 10_000, 20_000];
const TRANSIENT_RE = /(EPERM|EBUSY|operation not permitted|resource busy)/i;

const runBuilderWithWaits = async (entry, args, cwd) => {
  for (let i = 0; i < BUILDER_TRIES; i += 1) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [entry, ...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    const ms = Date.now() - t0;
    if (r.status === 0) {
      log(
        `  ✅ 打包到 release/${PACK_OUT}（${String(ms)}ms${i === 0 ? '' : `，第 ${String(i + 1)} 次尝试成功`}）`,
      );
      return;
    }
    const whole = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
    const hits = errorHits(whole, 4);
    if (!TRANSIENT_RE.test(whole) || i === BUILDER_TRIES - 1) {
      fail(
        `打包失败（退出码 ${String(r.status)}，耗时 ${String(ms)}ms，共试 ${String(i + 1)} 次）`,
        `${hits}\n--- 尾部 ---\n${whole.slice(-700)}`,
      );
    }
    const wait = BUILDER_WAITS[i];
    log(`  ⚠️ 第 ${String(i + 1)} 次打包被本机短暂锁挡住（${String(ms)}ms）：${hits.split('\n')[0] ?? '(没抓到错误行)'}`);
    log(`     等 ${String(wait)}ms 后重试 —— 依据是实测事实：**同一次改名过几分钟再试只用 2ms**`);
    // 重试前把上一次的残骸清掉（清不动也不中止：等一会儿它就松了）
    for (const stale of ['win-unpacked.tmp', 'win-unpacked']) {
      try {
        rmSync(join(RUN_OUT_DIR, stale), { recursive: true, force: true });
      } catch {
        /* 等一会儿再试 —— 这不算静默：下一次失败照样把错误行交出来 */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
};

const buildPack = async () => {
  const desktopDir = join(here, '..');
  const viteEntry = join(desktopDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
  const builderEntry = join(here, '..', '..', '..', 'node_modules', 'electron-builder', 'cli.js');
  for (const [who, p] of [['electron-vite', viteEntry], ['electron-builder', builderEntry]]) {
    if (!existsSync(p)) {
      fail(`找不到 ${who} 的入口：${p}`, '依赖装法变了就去同步这个路径 —— **不许改成静默跳过这一步**');
    }
  }
  runBuild('构建开发产物（electron-vite build）', viteEntry, ['build'], desktopDir);
  await runBuilderWithWaits(
    builderEntry,
    ['--win', '--dir', `--config.directories.output=release/${PACK_OUT}`],
    desktopDir,
  );
  /** 自我校验：退出码 0 不代表产物真落在了我们说的那个目录里（`--config` 没生效就是这种"看着成功"）*/
  if (!existsSync(EXE)) {
    let listing = '(那个目录读不到)';
    try {
      listing = readdirSync(RUN_OUT_DIR).join(', ');
    } catch {
      /* 读不到就把这句话照实交出去，不编 */
    }
    fail(
      `electron-builder 退出码 0，但产物不在 release/${PACK_OUT}/win-unpacked —— 输出目录参数没生效？`,
      `该目录里现在是：${listing}`,
    );
  }
};

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
  /**
   * 打包这一步**放在 try 里面**：临时目录已经在上面建好了，
   * 打包失败如果绕过 `finally`，就会在机器上留下一只没人认领的 `.tmp/verify-pack-*`
   * —— 与 T66 / T68 是同一条教训（"失败的那条路上，收尾跑了吗"）。
   */
  sweepOldPackDirs();
  if (BUILD) {
    log(`\n[打包] 本轮写到专属目录 release/${PACK_OUT}（T67：不与任何一轮共用产物目录）`);
    await buildPack();
  } else {
    log(`\n[人工模式] 只验现成产物 release/${packRel}，本轮不打包`);
  }

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
  finished = true;
} catch (err) {
  if (!(err instanceof PackAbort)) {
    // 意外异常：借 fail 把"做到哪一步"说出来；它抛的哨兵在这里咽掉（话已经说完了）
    try {
      fail('执行过程中抛异常', err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err));
    } catch {
      /* 故意空着 */
    }
  }
} finally {
  if (app !== undefined) await app.close().catch(() => undefined);
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    console.log(`（提示）本轮临时目录未能自动清理：${TMP} —— 交给 scripts/cleanup.py 处理`);
  }
  /**
   * 本轮那一族的产物目录**由本轮收走**（谁造的谁认领）。
   * 关掉应用与系统释放句柄之间有一小段窗口，所以给三次短重试；
   * 真删不掉就**把"没删掉"说出来**（下一轮的 `sweepOldPackDirs` 会再试一次），
   * 而不是假装清理完成了 —— "还原成功"必须是被报告的事实，不是我的记忆。
   */
  if (BUILD) {
    let removed = false;
    let lastErr = '';
    for (let i = 0; i < 3 && !removed; i += 1) {
      try {
        rmSync(RUN_OUT_DIR, { recursive: true, force: true });
        removed = !existsSync(RUN_OUT_DIR);
      } catch (err) {
        lastErr = String(err instanceof Error ? err.message : err).slice(0, 140);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    console.log(
      removed
        ? `（清理）本轮产物目录已删除：release/${PACK_OUT}/`
        : `（清理未成）release/${PACK_OUT}/ 还留着${lastErr === '' ? '' : `：${lastErr}`} —— 下一轮开跑前会再扫一次`,
    );
  }
}

process.exit(finished ? 0 : 1);
