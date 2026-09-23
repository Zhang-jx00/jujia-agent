#!/usr/bin/env node
/**
 * 文档检查器的**破坏性验证**（"它真的会咬吗"）。
 *
 * 为什么需要这一步：一个永远通过的检查等于没有检查 —— 项目里已经踩过多次
 * "测试看着绿、其实什么都没锁住"（自引用断言、空转测试、用例取值抹平差异……）。
 * 所以每次给检查器加规则，都用这个脚本证明它**在漂移出现时确实会失败**。
 *
 * 做法：内存备份原文 → 注入一处漂移 → 跑检查器断言退出码 1 → 写回原文 → 再跑断言退出码 0。
 * 全程不落临时文件（`.tmp` 可能被清理），子进程用**异步 spawn**（本环境同步 spawn 不可用）。
 *
 * 用法：node scripts/verify-docs-check.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runCheck() {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/check-docs.mjs'], { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('error', () => done({ code: null, out }));
    child.on('close', (code) => done({ code, out }));
  });
}

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

const base = await runCheck();
if (base.code !== 0) {
  fail('基线状态下检查器就已经失败 —— 请先修好文档再跑这个验证');
}

/** 每个用例：文件、要替换的片段、替换成什么、期望命中的检查项名 */
const cases = [
  {
    name: '不存在的 npm 脚本',
    file: 'README.md',
    from: 'npm run mut            #',
    to: 'npm run totally-bogus    #',
    expect: 'README 提到的 npm 脚本都存在',
  },
  {
    name: '失效的相对链接',
    file: 'README.md',
    from: '| 第三方依赖与许可证 |',
    to: '| 故意漂移 | [不存在](docs/NOT-EXIST-xyz.md) |\n| 第三方依赖与许可证 |',
    expect: 'README 相对链接都指向存在的文件',
  },
  {
    name: '门禁数量写错（五件套）',
    file: 'README.md',
    from: '门禁全绿、复核两遍',
    to: '五件套门禁、复核两遍',
    expect: '除 PROGRESS 外没有',
  },
  {
    name: 'e2e 步数与脚本不一致',
    file: 'README.md',
    from: '13 步全自动',
    to: '99 步全自动',
    expect: 'e2e 步数与脚本一致',
  },
];

for (const c of cases) {
  const path = join(repoRoot, c.file);
  const original = readFileSync(path, 'utf8'); // 内存备份，不落盘
  if (!original.includes(c.from)) {
    fail(`用例「${c.name}」的锚点未命中 —— 请更新本脚本的锚点`);
  }
  try {
    writeFileSync(path, original.replace(c.from, c.to), 'utf8');
    const r = await runCheck();
    if (r.code !== 1) fail(`用例「${c.name}」没有被拦住（检查器退出码 ${String(r.code)}，应为 1）`);
    if (!r.out.includes(c.expect)) {
      fail(`用例「${c.name}」虽然失败，但不是期望的那条检查（期望包含「${c.expect}」）`);
    }
    console.log(`  ✅ 被拦住：${c.name}`);
  } finally {
    writeFileSync(path, original, 'utf8');
  }
}

const after = await runCheck();
if (after.code !== 0) fail('还原后检查器仍失败 —— 基线已被污染，请人工检查');

console.log('\nDOCS-CHECK SELFTEST OK：4 处注入的漂移全部被拦住，还原后检查器恢复通过。');
