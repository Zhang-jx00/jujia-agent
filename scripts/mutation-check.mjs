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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const specPath = resolve(repoRoot, process.argv[2] ?? 'review/mutations.json');
const vitestEntry = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

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

  process.exit(missed === 0 && broken === 0 && unrunnable === 0 && restoreOk ? 0 : 1);
}

await main();
