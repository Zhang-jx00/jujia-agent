#!/usr/bin/env node
/**
 * 变异测试执行器（复核规范步骤 2 的工具化）。
 *
 * 为什么要有它：项目约定「每个阶段至少 1 个变异测试」，此前每轮都是临时拼命令，
 * 既容易漏（这轮就发现上三轮的 CHANGELOG 漏记），又容易踩两个已知的坑：
 *
 *   坑 1（复核 001 R2-9）：用 `git checkout -- <file>` 还原变异，
 *        会连带丢弃同一文件里**未提交**的修复，实测导致功能再次损坏。
 *        → 本脚本一律用**内存备份 + 写回**还原，绝不碰 git。
 *   坑 2（复核 007）：变异注入失败时若静默继续，会被误判成「被拦住了」。
 *        → 锚点不匹配时**显式报错并计入失败**，且退出码非 0。
 *   坑 3（复核 019，2026-09-23 实测）：
 *        ① **子进程没跑起来**（`spawnSync` 在本环境一律 EBUSY）被当成"测试失败"
 *           → 十项变异齐刷刷显示"被拦住" —— **假的信心**，比没跑还危险；
 *        ② 本环境的同步 spawn（`spawnSync`）**不可用**，必须用**异步 spawn**。
 *        → 已全部改异步；并把"无法运行"单独成一类，**不计入"被拦住"**。
 *
 * 用法：
 *   npm run mut                                  （推荐：npm 入口）
 *   node scripts/mutation-check.mjs [变异定义.json]
 *   默认读取 review/mutations.json
 *
 * 变异定义格式：
 * {
 *   "note": "本轮说明",
 *   "mutations": [
 *     { "id": "M1", "desc": "改坏了什么", "file": "相对路径",
 *       "find": "必须唯一命中的原始片段", "replace": "替换成的片段",
 *       "test": "要跑的测试文件或目录" }
 *   ]
 * }
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const specPath = resolve(repoRoot, process.argv[2] ?? 'review/mutations.json');
const vitestEntry = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

/* ------------------------------------------------------------------ *
 * 「正在跑」的标记 + 「被杀也能还原」的备份（T86 · R63）
 * ------------------------------------------------------------------ *
 * 根因：**门禁被杀掉 ≠ 门禁跑完了**。此前还原只有 `finally` 一条路 ⇒ 进程被中止时
 * 注入形态**留在工作树里**，而没有任何门禁知道"上一次变异跑没跑完"
 * （R62 实测撞上：工作树里留着 M64 的注入形态，直接提交就会把坏代码带进仓）。
 *
 * 三件东西：
 *   ① `<git-dir>/mutation-running.json` —— 「正在跑」的标记（跑完即删）；
 *   ② `<git-dir>/mutation-backup/` —— 每个靶子文件**注入前**的原文（还原后即删）；
 *   ③ 下一轮启动时若发现标记、且**持有它的进程已经不在** ⇒ **自动按备份还原**。
 *
 * 为什么放 `<git-dir>`（本仓即 `.git/`）而不是 `.tmp/`：
 * `cleanup.py` 的跳过名单含 `.git`，而 `.tmp` 会被**整只**搬进回收站 ——
 * 标记被搬走 ⇒ 判据看不见 ⇒ 门禁又变回"以为跑完了"。`.git/` 天然按 checkout 隔离。
 */
const gitDir = (() => {
  const dot = resolve(repoRoot, '.git');
  try {
    if (existsSync(dot) && statSync(dot).isDirectory()) return dot;
    if (existsSync(dot)) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'));
      if (m?.[1]) return resolve(repoRoot, m[1].trim());
    }
  } catch {
    /* 读不到就按目录处理，下面写文件时会报错 */
  }
  return dot;
})();
const MARKER_PATH = resolve(gitDir, 'mutation-running.json');
const BACKUP_DIR = resolve(gitDir, 'mutation-backup');

/** 进程还在不在（ESRCH = 不在；EPERM = 在但没权限 ⇒ 算"还在"） */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function readMarker() {
  if (!existsSync(MARKER_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MARKER_PATH, 'utf8'));
  } catch {
    return { unreadable: true };
  }
}

/**
 * 上一轮没跑完 ⇒ 按备份还原（**被杀也能还原**）。
 * @returns {{ restored: number, note: string } | null}
 */
function recoverStaleRun() {
  const marker = readMarker();
  if (!marker) return null;
  if (marker.unreadable) {
    return { restored: 0, note: `发现标记文件但读不出来（${MARKER_PATH}）⇒ 请人工核对工作树` };
  }
  if (pidAlive(marker.pid) && marker.pid !== process.pid) {
    return {
      restored: 0,
      note: `另有一轮变异正在跑（pid ${String(marker.pid)}）⇒ 本轮不启动，避免两边互相踩`,
    };
  }
  let restored = 0;
  for (const [rel, backup] of Object.entries(marker.backups ?? {})) {
    const target = resolve(repoRoot, rel);
    const src = resolve(BACKUP_DIR, backup);
    if (!existsSync(src)) continue;
    try {
      writeFileSync(target, readFileSync(src));
      restored += 1;
    } catch {
      /* 还原不了就留给人看，标记会留着 */
    }
  }
  rmSync(MARKER_PATH, { force: true });
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  return {
    restored,
    note:
      `上一轮变异**没跑完**（pid ${String(marker.pid)} 已不在）⇒ 已按备份还原 ${String(restored)} 个文件` +
      '（若仍有残留，请 `git diff` 逐处核对）',
  };
}

function writeMarker(marker) {
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(MARKER_PATH, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * 起一个子进程并等它结束（**异步 spawn**）。
 *
 * 为什么不用 `spawnSync`：2026-09-23 实测，本环境里同步 spawn **一律 EBUSY**
 * （连 `node -e` 也不行），而异步 spawn 正常。改用异步后变异测试才真的跑得起来。
 */
function runChild(command, args, opts = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' }, ...opts });
    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (out += String(d)));
    child.on('error', (err) => finish({ code: null, out, error: err.message }));
    child.on('close', (code) => finish({ code, out: stripAnsi(out), error: null }));
  });
}

/** 跑一次测试，返回 `{ failed, code, out, spawnError }`（`failed` 仅表示"测试真的失败了"） */
async function runTest(testPath) {
  const r = await runChild(process.execPath, [vitestEntry, 'run', testPath]);
  if (r.error !== null || r.code === null) {
    return {
      failed: false,
      code: r.code,
      out: r.out,
      spawnError: r.error ?? `子进程未正常退出（code=${String(r.code)}）`,
    };
  }
  return { failed: r.code !== 0, code: r.code, out: r.out, spawnError: null };
}

async function main() {
  if (!existsSync(specPath)) {
    console.error(`找不到变异定义：${specPath}`);
    process.exit(2);
  }
  if (!existsSync(vitestEntry)) {
    console.error(`找不到 vitest 入口：${vitestEntry}（请先 npm i）`);
    process.exit(2);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const mutations = Array.isArray(spec.mutations) ? spec.mutations : [];
  if (mutations.length === 0) {
    console.error('变异定义里没有任何 mutation');
    process.exit(2);
  }

  console.log(`变异定义：${specPath}`);
  if (spec.note) console.log(`说明：${spec.note}`);
  console.log(`共 ${mutations.length} 项\n`);

  /**
   * **跑之前先把所有锚点在各自文件里数一遍**（规整17 加的预检，2026-10-15）。
   *
   * 为什么要预检：本轮全量跑抓出 **6 条"锚点命中 0 次"**（M46 / M148 / M163 / M181 / M256 / M261），
   * 逐条查下来全是"合法改动把靶文本搬走、改写、或多缩进一层"：文案从弹窗挪进穷举表、
   * 三元式改成多段拼接、替换那趟被包进线性预检的 `if` 里……**产品没坏，是靶面漂了**。
   * 真正的教训在跑序：交付轮只跑**新增子集**，旧靶面的锚点没人复扫 ⇒ 漂移要等到收口轮的全量跑才现形，
   * 而中间每一轮那几条变异报的都是"注入失败"（**不是"拦住了"**——它根本没注入）。
   * 所以这件事不能靠"记得跑全量"，要变成**任何一次运行都先过的闸门**：
   * 命中数不等于 1 就当场列名并以退出码 2 收场，**一条变异都不注入**（半跑的状态最难查）。
   */
  const stale = [];
  const missing = [];
  for (const m of mutations) {
    const file = resolve(repoRoot, m.file);
    if (!existsSync(file)) {
      missing.push(`${m.id} → ${m.file}`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const hits = text.split(m.find).length - 1;
    if (hits !== 1) stale.push(`${m.id}（命中 ${String(hits)} 次）→ ${m.file}`);
  }
  if (missing.length > 0 || stale.length > 0) {
    console.error(`❌ 锚点预检未通过 —— 共 ${mutations.length} 项里：文件不存在 ${missing.length} 条 / 锚点命中数不是 1 ${stale.length} 条`);
    for (const s of missing) console.error(`   [文件不存在] ${s}`);
    for (const s of stale) console.error(`   [锚点漂移] ${s}`);
    console.error(
      '   这不是"变异没打中"，是**这条变异根本没注入** —— 先按当前源码重新对准靶心（内容一字不改地搬过去），' +
        '再重跑；判据放宽或删条目都等于承认这条防线不要了。',
    );
    process.exit(2);
  }
  console.log(`锚点预检通过：${mutations.length} 条靶文本在各自文件里都恰好命中 1 次\n`);

  /**
   * **开工前的自愈**：上一轮被中止 ⇒ 标记还在 ⇒ 先按备份还原，再开跑（T86）。
   * 放在锚点预检**之后**：预检不过时本轮一条都不注入，也不该动工作树。
   */
  const recovered = recoverStaleRun();
  if (recovered) {
    if (recovered.restored === 0 && recovered.note.includes('正在跑')) {
      console.error(`❌ ${recovered.note}`);
      process.exit(2);
    }
    console.log(`ℹ️ ${recovered.note}`);
  }

  /** 「正在跑」的标记（跑完即删；被中止时留在原地 ⇒ 判据看得见） */
  const marker = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    spec: specPath,
    total: mutations.length,
    backups: {},
  };
  writeMarker(marker);

  const results = [];

  for (const m of mutations) {
    const file = resolve(repoRoot, m.file);
    const row = { id: m.id, desc: m.desc, outcome: '', detail: '' };

    if (!existsSync(file)) {
      row.outcome = '❌ 注入失败';
      row.detail = `文件不存在：${m.file}`;
      results.push(row);
      continue;
    }

    // **内存备份，不落盘**：不产生临时文件，也就不会撞上沙箱的"同轮删除次数"阈值
    const original = readFileSync(file, 'utf8');
    const hits = original.split(m.find).length - 1;
    if (hits !== 1) {
      // 显式失败：命中 0 次说明锚点过时；命中多次说明锚点不唯一（改错地方的风险）
      row.outcome = '❌ 注入失败';
      row.detail = `锚点命中 ${hits} 次（要求恰好 1 次）—— 锚点已过时，请更新`;
      results.push(row);
      continue;
    }

    // **落盘备份**（T86 · 在内存备份之外加的第三道）：
    //   内存那份负责正常路径的还原；这份在 `<git-dir>/mutation-backup/`（**不是** `.tmp/` ——
    //   `.tmp` 会被 cleanup 整只搬走，标记与备份一起消失 ⇒ 门禁又变回"以为跑完了"）。
    //   作用只有一个：**进程被中止时也能还原**（那时内存那份已经随进程一起没了）。
    //   还原成功后立刻删掉，不留垃圾。
    const backupName = `${String(results.length).padStart(3, '0')}-${m.id}.bak`;
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(resolve(BACKUP_DIR, backupName), original, 'utf8');
    marker.backups[m.file] = backupName;
    writeMarker(marker);

    try {
      writeFileSync(file, original.replace(m.find, m.replace), 'utf8');

      const r = await runTest(m.test);
      if (r.spawnError !== null) {
        // 跑不起来 ≠ 被拦住。混为一谈会给出**假的信心**（2026-09-23 实测踩过）
        row.outcome = '❌ 无法运行';
        row.detail = `子进程未启动：${r.spawnError}`;
      } else {
        row.outcome = r.failed ? '✅ 被拦住' : '⚠️ 未被拦住（测试没发现问题！）';
        const failedCount = /Tests\s+(\d+) failed/.exec(r.out)?.[1];
        row.detail = failedCount ? `失败 ${failedCount} 例` : `退出码 ${r.code}`;
      }
    } finally {
      // 无论测试怎么崩都要把原文写回去（包括 vitest 自身抛错的情况）
      writeFileSync(file, original, 'utf8');
      rmSync(resolve(BACKUP_DIR, backupName), { force: true });
      delete marker.backups[m.file];
      writeMarker(marker);
    }
    results.push(row);
  }

  // 还原后必须复跑一遍，确认"还原"本身没有污染基线
  console.log('还原后复跑受影响文件（确认基线未被污染）：');
  const affected = [...new Set(mutations.map((m) => m.test))];
  let restoreOk = true;
  /** 还原后的复跑是否因**环境**没跑起来（与"基线真被污染"要分开报） */
  let restoreSpawnFailed = false;
  for (const t of affected) {
    const r = await runTest(t);
    if (r.spawnError !== null) {
      restoreOk = false;
      restoreSpawnFailed = true;
      console.log(`  ❌ 无法运行  ${t}  （子进程未启动：${r.spawnError}）`);
      continue;
    }
    if (r.failed) restoreOk = false;
    console.log(`  ${r.failed ? '❌ 仍失败' : '✅ 通过'}  ${t}`);
  }

  const gitStatus = await runChild('git', ['status', '--porcelain']);
  const workspaceDirty = gitStatus.out.trim() !== '';

  console.log('\n结果');
  for (const r of results) {
    console.log(`  ${r.outcome}  ${r.id}  ${r.desc}  ${r.detail ? `（${r.detail}）` : ''}`);
  }

  // 用前缀匹配而不是全等：结果串后面还带着说明文字，全等会把"未被拦住"漏算成 0
  // （复核 010 实测：这个 bug 让一次真实的变异逃逸被汇总成 "未被拦住 0"，并以退出码 0 通过）
  const blocked = results.filter((r) => r.outcome.startsWith('✅')).length;
  const missed = results.filter((r) => r.outcome.startsWith('⚠️')).length;
  const unrunnable = results.filter((r) => r.outcome.startsWith('❌ 无法运行')).length;
  const broken = results.filter((r) => r.outcome.startsWith('❌ 注入失败')).length;

  console.log(`\n合计：被拦住 ${blocked} / 未被拦住 ${missed} / 注入失败 ${broken} / 无法运行 ${unrunnable}`);
  if (workspaceDirty) {
    console.log('⚠️ 工作区仍有改动 —— 变异还原可能不完整，请人工检查 git status');
  }
  if (restoreOk === false && restoreSpawnFailed === false) {
    console.log('⚠️ 还原后测试仍失败 —— 基线已被污染，请人工检查');
  }
  if (restoreSpawnFailed) {
    console.log('⚠️ 还原后的复跑也**没能启动**测试子进程 —— 请先修环境，不要据此判定基线污染');
  }
  if (missed > 0) {
    console.log('❌ 存在未被拦住的变异 —— 测试有缺口，必须补测试后重跑');
  }
  if (unrunnable > 0) {
    console.log(
      '❌ 有变异**根本没跑起来**（子进程未启动）—— 本次结论不可信，' +
        '这类失败**不算"被拦住"**。请修好环境后重跑，别让假的绿色混进台账。',
    );
  }

  /**
   * **跑完了 ⇒ 标记与备份一并撤掉**（T86）。
   * 撤不掉也要说：标记留着 ⇒ 下一轮的判据会红 ⇒ 那正是"没跑完"该有的样子。
   */
  rmSync(MARKER_PATH, { force: true });
  rmSync(BACKUP_DIR, { recursive: true, force: true });

  process.exit(missed === 0 && broken === 0 && unrunnable === 0 && restoreOk ? 0 : 1);
}

await main();
