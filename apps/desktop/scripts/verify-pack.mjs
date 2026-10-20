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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
 * ② **这一步为什么还会红**（R35 全天 6+3 次尝试的底账 —— 这条因果本轮被改了**三次**口，每次都以实测为准）：
 *    `electron-builder` 解 Electron 运行时是"写 `win-unpacked.tmp` 再 rename 成正式目录"，
 *    而本机有常驻进程（监视 / 索引 / 实时扫描）会在 `rename` 那一刻握着 `.tmp` 里的
 *    `resources/default_app.asar` ⇒ 当场 EPERM。今天跑出来的六条事实：
 *    · **换目录不是药**：全新目录（里面什么都没有）第一次跑**照样 EPERM**；
 *    · **原地多等也不是药**：失败留下的那只 asar **32 分钟后仍改不动（EBUSY）**，
 *      而且旧重试每次先 `unlink` 上一回的残骸 ⇒ 第二次尝试**根本没走到 rename**就红了
 *      （14:45 那轮的第 2/3/4 次全是 `EBUSY ... unlink ... default_app.asar`）；
 *    · **重试还可能把错误换一种**：残骸被清掉后 electron-builder 会去**联网重取**运行时，
 *      本机那一刻连不上 GitHub ⇒ `connect ETIMEDOUT`，单次尝试烧掉 **199 秒**，真因被盖住；
 *    · **位置只是相关，不是决定**：产物目录放工作区根**之外**（同一个盘）2 次全绿、
 *      根**之内** 6 试 4 红 2 绿 —— 所以不能说"挪出去就好"，也不能说"之内必红"；
 *    · **有意思的是绿的那两次都慢**：首attempt 成功的那两次耗时 30.0s / 60.4s，
 *      红的那几次首attempt 只用 7.5–8.0s ⇒ 现在的最好解释是**竞态**：解包一结束就去 rename，
 *      撞上扫描者正握着那只新写的 asar；解包本身慢（缓存冷、要重下）反而把窗口让过去了；
 *    · 绿那两次之后的**清残骸只用 0.6–0.8 秒**，红的几处删到这只 asar 就停在 `Device or resource busy`。
 *    ⇒ 这个脚本因此只做两件事：**不原地盲等**（红得越快越不烧别人的额度），
 *      以及**把红说成可指路的红**（`lockProbe` 当场试一次改名，回答"句柄此刻还在不在"）。
 *      操作口径：**红了就直接重跑一次** —— 重跑用的是全新目录、不碰旧残骸，等于把这一次尝试重新掷一次骰子；
 *      连红两把就按取证判"这台机器此刻验不了打包产物"，台账记"未能运行 + 原因"，**不许记成绿、也不许写成产品缺陷**。
 *      至于"每次尝试都换一只全新目录"这种自动化（把重跑搬进门禁内部），本轮没做，登记为 T69。
 *    作废的旧结论一并留档：R29 的"换目录也绕不开"、规整19 的"换目录一次成功"、
 *    本轮上一版的"本机短暂握着、等一会儿就松开"、以及今天中午记的"过几分钟改名成功 ⇒ 锁是短暂的"
 *    —— 见复核 092 与 093。
 *
 * `JUJIA_PACK_DIR` 保留成人工口子，含义改窄：**设了它 = 只验这份现成产物、本轮不打包**。
 */
const RUN_ID = `${Date.now().toString(36)}-${process.pid}`;
const RELEASE_DIR = join(here, '..', 'release');
const manualDir = process.env.JUJIA_PACK_DIR;
const BUILD = manualDir === undefined || manualDir === '';

/**
 * **本轮这一族的目录名 —— 每次打包尝试换一只**（T69① · R37）。
 *
 * 为什么必须是"每次尝试一只"（而不是"本轮一只，重试在里面接着用"）：
 * R35 的实测把这件事说死了 —— **旧重试每次先 `unlink` 上一回残骸**，
 * 于是第二次尝试**根本没走到 `rename`** 就红在 `EBUSY ... unlink ... default_app.asar` 上；
 * 换句话说：**同一只目录上的"重试"不是重试，是接着上一次的残骸再撞一次同一堵墙**。
 * 真正意义的重试 = **换一只全新的空目录**（同一条命令 6 试 4 红 2 绿，
 * 而"全新空目录第一次照样红"这条事实说明**换目录也不是药** —— 换目录只是让"重试"真的是重试，
 * 而不是让"重跑"变成"接着撞"）。
 *
 * 所以这里用 `let` 而不是 `const`：**打包尝试序号进目录名**，
 * 重试时换一只新目录（`pack-<run id>-a2` / `-a3`…），旧目录留给 `sweepOldPackDirs` 扫。
 */
let packAttempt = 0;
const packOutName = () => (packAttempt === 0 ? `pack-${RUN_ID}` : `pack-${RUN_ID}-a${String(packAttempt + 1)}`);
let PACK_OUT = packOutName();
/** 产物相对路径（`BUILD` 时随尝试变，人工指定时固定） */
const packRelNow = () => (BUILD ? join(PACK_OUT, 'win-unpacked') : manualDir);
let EXE = join(RELEASE_DIR, packRelNow(), 'JujiaAgent.exe');
/** 本轮这一族的目录（收尾删它） */
let RUN_OUT_DIR = join(RELEASE_DIR, PACK_OUT);
/** 与产物目录同级的 `.tmp`：它卡在原地就是"被谁握着"的样子，预检要把这句话说明白 */
const staleTmpNow = () => join(dirname(join(RELEASE_DIR, packRelNow())), 'win-unpacked.tmp');
let STALE_TMP = staleTmpNow();

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
        '   R35 全天底账（同一条命令 6 试 4 红 2 绿）把这条锁说清了：\n' +
        '   · **跟目录叫什么名字无关**：全新空目录第一次打照样 EPERM；\n' +
        '   · **不是等得来的**：失败留下的 `win-unpacked.tmp/resources/default_app.asar` **32 分钟后仍 EBUSY**；\n' +
        '   · **跟位置相关但不决定性**：产物写到工作区根**之外**（同一个盘）2 试全绿、写到**之内** 6 试 4 红 2 绿，\n' +
        '     而绿的两次首attempt 都慢（30.0s / 60.4s）、红的只用 7.5–8.0s ⇒ 现在最好的解释是**竞态窗口**；\n' +
        '   ⇒ 所以默认路径这条门禁**不原地盲等**，改为**每次红都当场试一次改名把"句柄还在不在"说出口**（见 `lockProbe`），\n' +
        '     红了就重跑一次（全新目录、不碰残骸）。只有人工指定现成产物时才会走到这条预检。\n' +
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
    // **本轮自己造的那几只（`-a2` / `-a3`…）不扫** —— 它们是本轮的，等 finally 统一收
    if (!name.startsWith('pack-')) continue;
    if (name === PACK_OUT || name.startsWith(`pack-${RUN_ID}`)) continue;
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
 * **打包这一步：先当场问"锁松了没"，再决定要不要重试**（R35 把盲等改成了看现场）。
 *
 * 上一版写的是"EPERM/EBUSY 就等 5/10/20s 再试，最多 4 次"，注释里还把它叫"真药"。
 * **本轮实测把这句话否掉了**，三条证据：
 * · 三次整跑、每次四回尝试，**重试一次都没救回来**（14:44 / 14:47 / 15:0x 全红）；
 * · 第二次尝试还会把错误**换成另一种红**：残骸被清掉后 electron-builder 去联网重取 Electron 运行时，
 *   而本机这一刻连不上 GitHub ⇒ `connect ETIMEDOUT 20.205.243.166:443`，**单这一回就耗 199 秒**
 *   —— 真因（本机锁）被一个网络错误盖住了，这就是"用重试洗白真错误"的实际样子；
 * · 每次重试都要重新解一遍运行时（约 370MB 新建文件），**它本身就是那把锁的燃料**。
 * 所以现在**最多试两次**，且中间必须先过 `lockProbe`：
 * 句柄还在 ⇒ **不重试**（这一族实测握到 32 分钟仍未松），直接交带取证的红；
 * 句柄已松 ⇒ 按真·瞬时锁处理，等 5s 再试一次（"几分钟后改名只用 2ms"今天中午实测过**一次**，
 * 够不上"锁都是短暂的"那条规律 —— 上一版就是这么写错的，这次只按"有这一类"用）。
 * **其余失败一次就报**，不许用重试把真错误洗白 —— 静默重试三次的"红"会被读成"环境噪声"，
 * 那就又是 T65 那种没人修的洞。
 */
const BUILDER_TRIES = 2;
const BUILDER_WAIT_MS = 5_000;
const TRANSIENT_RE = /(EPERM|EBUSY|operation not permitted|resource busy)/i;

/**
 * **锁的现场取证**：当场试一次"给那只解包用的 asar 改名"（成功就立刻改回来，内容一个字节不动）。
 *
 * 只回答一个问题：**句柄此刻还在不在**（返回值里的 `held`）。
 * · 在 ⇒ 是"工作区根之内被本机常驻进程盯着"那一族（环境侧）——**不是产品坏，也不许记成绿**；
 * · 不在 ⇒ 才轮到重试，或者按错误行本身重算这一笔，别顺着上一句往下抄。
 * 为什么值得为它写一段代码：R35 之前这类红只在台账里留过一句"本机 EBUSY"，
 * 于是同一件事连着三轮没人能判断"是产品坏了还是这台机器不能验"（T65 那类洞的同源形状）。
 *
 * @returns {{ held: boolean, text: string }}
 */
const lockProbe = () => {
  const asar = join(RUN_OUT_DIR, 'win-unpacked.tmp', 'resources', 'default_app.asar');
  if (!existsSync(asar)) {
    return { held: false, text: '现场取证：本轮目录里没有那只解包用的 asar ⇒ 红的不是这一把锁，按上面的错误行判' };
  }
  const t0 = Date.now();
  try {
    renameSync(asar, `${asar}.fx`);
    const ms = Date.now() - t0;
    try {
      renameSync(`${asar}.fx`, asar);
    } catch (e) {
      return { held: false, text: `现场取证：改名**成功**（${String(ms)}ms）但**还原失败**（${String(e.code)}）—— 现场已被改成 default_app.asar.fx，请人工看一眼` };
    }
    return { held: false, text: `现场取证：改名**改得动**（${String(ms)}ms）⇒ 句柄这一刻松了，按真·瞬时锁处理` };
  } catch (e) {
    return {
      held: true,
      text: `现场取证：改名**改不动**（${String(e.code)}，${String(Date.now() - t0)}ms）⇒ 句柄还在别人手里。\n` +
        '   R35 底账：同一条命令今天 6 试 4 红 2 绿 —— 绿的两次首attempt 都**慢**（30.0s / 60.4s）、' +
        '红的几次首attempt 只用 7.5–8.0s ⇒ 最好解释是**解包刚结束就去 rename** 撞上本机扫描/索引者的竞态；' +
        '与目录叫什么名字无关（全新空目录照样红），与工作区根之内/外**相关但不决定**（之外 2 试全绿、之内 6 试 4 红）。\n' +
        '   操作口径：**直接重跑一次**（重跑用全新目录，不碰这些残骸）；连红两把就判"这台机器此刻验不了打包产物"，\n' +
        '   台账只能记"**未能运行 + 原因**"—— **不许记成绿，也不许写成产品缺陷**；' +
        '要自动化"每轮回全新目录"或把产物挪出项目文件夹，都得所有者点头（已登记 T69）。',
    };
  }
};

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
    /** 现场取证先于"要不要再试一次"这个决定 —— 这一句把等待从盲等变成有条件的等 */
    const probe = lockProbe();
    if (!TRANSIENT_RE.test(whole) || probe.held || i === BUILDER_TRIES - 1) {
      /**
       * 取证文本排在**最前**：`fail()` 把 detail 截到 900 字，
       * 上一版把这段放在 700 字的尾部之后，等于**当场把它截掉了**（15:11 那次实测：
       * 日志里压根没有"现场取证"这一行 —— 写了指路的话却不让它出门，跟没写一样）。
       */
      fail(
        `打包失败（退出码 ${String(r.status)}，耗时 ${String(ms)}ms，共试 ${String(i + 1)} 次）`,
        `${probe.text}\n--- 错误行 ---\n${hits}\n--- 尾部（截 300 字） ---\n${whole.slice(-300)}`,
      );
    }
    log(`  ⚠️ 第 ${String(i + 1)} 次打包被锁挡住（${String(ms)}ms）：${hits.split('\n')[0] ?? '(没抓到错误行)'}`);
    log(`     ${probe.text} ⇒ 等 ${String(BUILDER_WAIT_MS)}ms 后只再试这一次`);
    /**
     * **换一只全新目录再试**（T69① · R37）—— 这一步是本轮的核心。
     *
     * 旧写法是"把上一回的残骸 `unlink` 掉，然后接着用**同一只**目录重试"，
     * 而 R35 的实测说死了那样不行：**第二次尝试根本没走到 `rename`**，
     * 就红在 `EBUSY ... unlink ... default_app.asar` 上（那是在清残骸时就撞上了）。
     * ⇒ 真正意义的重试是**换一只空的目录**，不是"在同一只上接着撞"。
     *
     * 注意这只目录**不删**（删不动 —— 那正是锁着的地方），
     * 留给下一轮 `sweepOldPackDirs` 去扫（它已经在扫上一轮同族了）。
     */
    packAttempt += 1;
    PACK_OUT = packOutName();
    RUN_OUT_DIR = join(RELEASE_DIR, PACK_OUT);
    EXE = join(RELEASE_DIR, packRelNow(), 'JujiaAgent.exe');
    STALE_TMP = staleTmpNow();
    log(`     ⇒ 换一只全新目录重试：release/${PACK_OUT}（旧的不碰、不删 —— 那是锁着的地方）`);
    /**
     * 换目录之后**输出参数必须跟着换** —— 否则 electron-builder 还是写回旧目录，
     * 那只旧目录正是被锁着的那只 ⇒ 等于"换了个名字接着撞"。
     * 这里按**参数名**找那一项（不按下标 —— 下标是"它碰巧在最后一位"，改个参数顺序就悄悄失效了）。
     */
    const outIdx = args.findIndex((a) => a.startsWith('--config.directories.output='));
    if (outIdx < 0) {
      fail(
        '内部错误：打包参数里找不到 --config.directories.output=',
        `参数是：${JSON.stringify(args)}\n没有它就换不了输出目录，重试会写回旧目录（那正是被锁着的那只）。`,
      );
    }
    args[outIdx] = `--config.directories.output=release/${PACK_OUT}`;
    await new Promise((resolve) => setTimeout(resolve, BUILDER_WAIT_MS));
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
    let removed = [];
    let lastErr = '';
    /**
     * **本轮可能造了不止一只目录**（T69①：每次重试换一只新的 ⇒ `pack-<id>` / `pack-<id>-a2` …）。
     * 收尾必须**把本轮造过的每一只都收走** —— 只收最后一只 = 把前几只留在盘上没人认领
     * （而它们恰恰是**被锁着的那几只**，下一轮开跑时又要在 `sweepOldPackDirs` 里再撞一次）。
     */
    const ownDirs = readdirSync(RELEASE_DIR).filter((n) => n === `pack-${RUN_ID}` || n.startsWith(`pack-${RUN_ID}-a`));
    for (const name of ownDirs) {
      const dir = join(RELEASE_DIR, name);
      for (let i = 0; i < 3; i += 1) {
        try {
          rmSync(dir, { recursive: true, force: true });
          if (!existsSync(dir)) { removed.push(name); break; }
        } catch (err) {
          lastErr = String(err instanceof Error ? err.message : err).slice(0, 140);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    }
    const left = ownDirs.filter((n) => !removed.includes(n));
    console.log(
      left.length === 0
        ? `（清理）本轮产物目录已删除：${removed.map((n) => `release/${n}/`).join('、')}`
        : `（清理未成）${left.map((n) => `release/${n}/`).join('、')} 还留着${lastErr === '' ? '' : `：${lastErr}`} —— 下一轮开跑前会再扫一次`,
    );
  }
}

process.exit(finished ? 0 : 1);
