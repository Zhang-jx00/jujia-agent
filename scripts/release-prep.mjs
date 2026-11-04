#!/usr/bin/env node
/**
 * **发布前路径：build → dist → verify:pack，一条命令**（R73 · 排查42 收口 · 原在制品线编号 R78）。
 *
 * ## 为什么要有它
 *
 * 现状是**三段各跑各的**，中间靠人记：
 *   · `npm run build` 产出 `out/`（开发产物）
 *   · `npm run dist` 产出安装包 —— 但它写进**固定目录** `apps/desktop/release/`
 *   · `npm run verify:pack` 自己再打一遍包，验完**把产物删掉**
 * ⇒ 于是「我这次要发的那份」和「门禁验的那份」**不是同一份东西**，
 *   而且固定目录会**被上一轮的句柄挡路**（R35/R37 连踩三轮的那个坑）。
 *
 * ## 这条路径保证什么
 *
 * ① **产物目录按运行 id 命名**（`release/rel-<运行 id>/`）⇒ 不与任何一轮共用目录，
 *    "这一轮验的是哪份产物"写在日志里就是事实；
 * ② **门禁验的就是要发的那一份**（`--dir` 出来的 `win-unpacked` 直接喂给 `verify-pack.mjs`，
 *    不重新打包 ⇒ 验的和发的是同一个目录）；
 * ③ **预检先拦掉已知的坑**：`node_modules` 若是**目录联接**，electron-builder 会
 *    「cannot find path for dependency」⇒ 产物里**一个生产依赖都没有**
 *    ⇒ 打包版主进程 `require("node-pty")` 直接失败 ⇒ **打包版根本起不来**
 *    （原线实测：A/B 对照已证明这是联接造成的，不是仓库缺陷）。
 *
 * ## 用法
 *
 *   node scripts/release-prep.mjs              # 完整跑：build → dist → verify:pack
 *   node scripts/release-prep.mjs --dry-run    # 只打印计划（不构建、不打包）—— 判据跑这个
 *   node scripts/release-prep.mjs --keep       # 验完保留产物（默认就是保留）
 *
 * ## 退出码
 *
 * 0 = 全程通过；1 = 某一环失败（打印失败在哪一环）；2 = 用法错。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const desktopDir = join(repoRoot, 'apps', 'desktop');
const releaseDir = join(desktopDir, 'release');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

/** 运行 id：时间戳（base36）+ 进程号 ⇒ 同一台机上两次跑不会撞目录 */
const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
/** **按运行 id 命名的产物目录**（不与任何一轮共用；这是 R35/R37 连踩三轮的教训） */
const OUT_NAME = `rel-${RUN_ID}`;
const OUT_DIR = join(releaseDir, OUT_NAME);

const log = (...a) => console.log(...a);
const fail = (text, detail) => {
  console.error(`\n❌ ${text}`);
  if (detail !== undefined) console.error(String(detail).slice(0, 1200));
  process.exit(1);
};

const plan = {
  runId: RUN_ID,
  outDir: OUT_NAME,
  outDirAbs: OUT_DIR,
  build: 'electron-vite build',
  pack: 'electron-builder --win --publish never',
  verify: 'node apps/desktop/scripts/verify-pack.mjs（JUJIA_PACK_DIR=rel-<运行 id>/win-unpacked）',
};

/**
 * **预检：`node_modules` 必须是真目录，不能是目录联接**。
 *
 * 为什么这是硬预检（原线实测 + A/B 对照）：
 * · 联接 ⇒ electron-builder 收不到生产依赖（`cannot find path for dependency …@undefined`）
 *   ⇒ 产物里没有 `node_modules/node-pty`、也没有 `app.asar.unpacked`
 *   ⇒ 打包版主进程在加载期就抛（`require("node-pty")`）
 *   ⇒ **进程活着但没有窗口、没有用户数据目录**（实测：无 renderer 子进程、user-data-dir 全空）
 *   ⇒ 门禁表现为"启动超时 180 秒"，**看不出真因**。
 *
 * @param {string} nmPath
 * @returns {string | null} 有问题就返回**说人话**的原因，没问题返回 `null`
 */
export function checkNodeModulesIsRealDir(nmPath) {
  if (!existsSync(nmPath)) return `目录不存在：${nmPath} ⇒ 先 npm ci`;
  if (lstatSync(nmPath).isSymbolicLink()) {
    return (
      `${nmPath} 是**目录联接** ⇒ electron-builder 会收不到生产依赖（产物缺 node-pty ⇒ 打包版起不来）。` +
      '原线实测过这条：门禁只会显示"启动超时 180 秒"，看不出真因。修法：把 node_modules 做成真目录（npm ci / 复制），别用联接。'
    );
  }
  return null;
}

/** 预检：把该查的都查一遍，返回问题清单 */
export function preflightProblems(repoRootPath, desktopDirPath) {
  const problems = [];
  for (const p of [
    checkNodeModulesIsRealDir(join(repoRootPath, 'node_modules')),
    checkNodeModulesIsRealDir(join(desktopDirPath, 'node_modules')),
  ]) {
    if (p !== null) problems.push(p);
  }
  const builderEntry = join(repoRootPath, 'node_modules', 'electron-builder', 'cli.js');
  if (!existsSync(builderEntry)) problems.push(`找不到 electron-builder 入口：${builderEntry}`);
  const viteEntry = join(desktopDirPath, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
  if (!existsSync(viteEntry)) problems.push(`找不到 electron-vite 入口：${viteEntry}`);
  return problems;
}

function preflight() {
  const problems = preflightProblems(repoRoot, desktopDir);
  if (problems.length > 0) {
    fail('发布前预检没过（这些会让"发出去之后"那一格验不成）', problems.join('\n     '));
  }
  log('  ✅ 预检：node_modules 是真目录、构建与打包入口都在');
}

/** 跑一条子进程命令，把输出透传；失败就报"失败在哪一环" */
function run(label, entry, cmdArgs, cwd, extraEnv = {}) {
  log(`\n→ ${label}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [entry, ...cmdArgs], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
  const ms = Date.now() - t0;
  const whole = `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`;
  if (r.status !== 0) {
    const hits = whole
      .split('\n')
      .filter((l) => /⨯|error|EPERM|EBUSY|rename|Cannot find|failed/i.test(l))
      .slice(0, 8)
      .join('\n');
    fail(`${label} 失败（退出码 ${String(r.status)}，耗时 ${String(ms)}ms）`, `${hits}\n--- 尾部 ---\n${whole.slice(-800)}`);
  }
  log(`  ✅ ${label}（${String(ms)}ms）`);
  return whole;
}

/** 产物清单：文件名 + 字节数 + sha256（发布页要贴哈希时不用再手搓一遍） */
function artifactManifest(dir) {
  const rows = [];
  const walk = (d) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, name.name);
      if (name.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(exe|7z|blockmap|zip)$/i.test(name.name)) continue;
      const bytes = statSync(full).size;
      const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
      rows.push({ file: relative(dir, full).replace(/\\/g, '/'), bytes, sha256: hash });
    }
  };
  if (existsSync(dir)) walk(dir);
  return rows;
}

/**
 * **是不是"作为脚本被跑起来的"**（而不是被别的模块 import 进来）。
 * 判据要 import 本模块里的预检函数（`checkNodeModulesIsRealDir`）来真撞一次联接 ⇒ 必须有这个守卫，
 * 否则 import 就会把整条发布路径执行一遍。
 */
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

function main() {
  if (dryRun) {
    // **stdout 只出 JSON**（机器可读：判据直接 parse 它）；说明文字走 stderr（人看的那份）
    console.log(JSON.stringify(plan, null, 2));
    console.error(
      '发布前路径（dry-run，不构建不打包）。\n' +
        '产物目录按运行 id 命名 ⇒ 不与任何一轮共用目录（R35/R37 那个"旧目录句柄挡路"的教训）。',
    );
    return;
  }

  /* ---------- 真正跑一遍 ---------- */
  log(`发布前路径 · 运行 id = ${RUN_ID}`);
log(`产物目录：${OUT_DIR}`);
preflight();

mkdirSync(OUT_DIR, { recursive: true });

const viteEntry = join(desktopDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const builderEntry = join(repoRoot, 'node_modules', 'electron-builder', 'cli.js');
const verifyEntry = join(desktopDir, 'scripts', 'verify-pack.mjs');

run('构建开发产物（electron-vite build）', viteEntry, ['build'], desktopDir);
run(
  '打包出安装包与免安装版（electron-builder --win）',
  builderEntry,
  ['--win', '--publish', 'never', `--config.directories.output=release/${OUT_NAME}`],
  desktopDir,
);

/** 把这一轮要发的产物交给门禁验（**不重新打包** ⇒ 验的和发的是同一份） */
const winUnpacked = join(OUT_NAME, 'win-unpacked');
if (!existsSync(join(releaseDir, winUnpacked))) {
  fail(`打包完了却找不到产物目录：${join(releaseDir, winUnpacked)}`, '输出目录参数没生效？');
}
run(
  '用打包产物跑 verify:pack（验的就是要发的那一份）',
  verifyEntry,
  [],
  desktopDir,
  { JUJIA_PACK_DIR: winUnpacked },
);

const rows = artifactManifest(OUT_DIR);
const manifestPath = join(OUT_DIR, 'ARTIFACTS.json');
writeFileSync(
  manifestPath,
  `${JSON.stringify({ runId: RUN_ID, generatedAt: new Date().toISOString(), artifacts: rows }, null, 2)}\n`,
  'utf8',
);
log(`\n产物清单（${String(rows.length)} 个）：`);
for (const r of rows) log(`  ${r.file} · ${String(r.bytes)} 字节 · sha256 ${r.sha256.slice(0, 16)}…`);
log(`清单已写入：${manifestPath}`);
log('\nRELEASE-PREP OK：build → dist → verify:pack 全程通过，产物在上面的目录里。');
log('（**产物不自动删**：它就是这一轮要发的东西；要清就手动删那个目录。）');
}

if (isMain) {
  main();
  process.exit(0);
}
