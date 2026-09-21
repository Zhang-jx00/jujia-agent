#!/usr/bin/env node
/**
 * 变异测试执行器（复核规范步骤 2 的工具化）。
 *
 * 为什么要有它：项目约定「每个阶段至少 1 个变异测试」，此前每轮都是临时拼命令，
 * 既容易漏（这轮就发现上三轮的 CHANGELOG 漏记），又容易踩两个已知的坑：
 *
 *   坑 1（复核 001 R2-9）：用 `git checkout -- <file>` 还原变异，
 *        会连带丢弃同一文件里**未提交**的修复，实测导致功能再次损坏。
 *        → 本脚本一律用**临时副本 + 文件复制**还原，绝不碰 git。
 *   坑 2（复核 007）：变异注入失败时若静默继续，会被误判成「被拦住了」。
 *        → 锚点不匹配时**显式报错并计入失败**，且退出码非 0。
 *
 * 用法：
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

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const specPath = resolve(repoRoot, process.argv[2] ?? 'review/mutations.json');
const vitestEntry = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

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

/** 跑一次测试，返回是否"测试失败"（= 变异被拦住） */
function runTest(testPath) {
  const r = spawnSync(process.execPath, [vitestEntry, 'run', testPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  return { failed: r.status !== 0, status: r.status, out };
}

console.log(`变异定义：${specPath}`);
if (spec.note) console.log(`说明：${spec.note}`);
console.log(`共 ${mutations.length} 项\n`);

const results = [];
let workspaceDirty = false;

for (const m of mutations) {
  const file = resolve(repoRoot, m.file);
  const backup = `${file}.mutbak`;
  const row = { id: m.id, desc: m.desc, outcome: '', detail: '' };

  if (!existsSync(file)) {
    row.outcome = '❌ 注入失败';
    row.detail = `文件不存在：${m.file}`;
    results.push(row);
    continue;
  }

  copyFileSync(file, backup);
  try {
    const src = readFileSync(file, 'utf8');
    const hits = src.split(m.find).length - 1;
    if (hits !== 1) {
      // 显式失败：命中 0 次说明锚点过时；命中多次说明锚点不唯一（改错地方的风险）
      row.outcome = '❌ 注入失败';
      row.detail = `锚点命中 ${hits} 次（要求恰好 1 次）—— 锚点已过时，请更新`;
      continue;
    }
    writeFileSync(file, src.replace(m.find, m.replace), 'utf8');

    const r = runTest(m.test);
    row.outcome = r.failed ? '✅ 被拦住' : '⚠️ 未被拦住（测试没发现问题！）';
    const failedCount = /Tests\s+(\d+) failed/.exec(r.out)?.[1];
    row.detail = failedCount ? `失败 ${failedCount} 例` : `退出码 ${r.status}`;
  } finally {
    // 一律用副本还原，绝不 git checkout（复核 001 R2-9）
    if (existsSync(backup)) {
      copyFileSync(backup, file);
      rmSync(backup);
    }
  }
  results.push(row);
}

// 还原后必须复跑一遍，确认"还原"本身没有污染基线
console.log('还原后复跑受影响文件（确认基线未被污染）：');
const affected = [...new Set(mutations.map((m) => m.test))];
let restoreOk = true;
for (const t of affected) {
  const r = runTest(t);
  if (r.failed) restoreOk = false;
  console.log(`  ${r.failed ? '❌ 仍失败' : '✅ 通过'}  ${t}`);
}

const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
workspaceDirty = (status.stdout ?? '').trim() !== '';

console.log('\n结果');
for (const r of results) {
  console.log(`  ${r.outcome}  ${r.id}  ${r.desc}  ${r.detail ? `（${r.detail}）` : ''}`);
}

const blocked = results.filter((r) => r.outcome === '✅ 被拦住').length;
const missed = results.filter((r) => r.outcome === '⚠️ 未被拦住').length;
const broken = results.filter((r) => r.outcome === '❌ 注入失败').length;

console.log(`\n合计：被拦住 ${blocked} / 未被拦住 ${missed} / 注入失败 ${broken}`);
if (workspaceDirty) {
  console.log('⚠️ 工作区仍有改动 —— 变异还原可能不完整，请人工检查 git status');
}
if (!restoreOk) console.log('⚠️ 还原后测试仍失败 —— 基线已被污染，请人工检查');

process.exit(missed === 0 && broken === 0 && restoreOk ? 0 : 1);
