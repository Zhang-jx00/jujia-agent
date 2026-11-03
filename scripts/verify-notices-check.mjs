#!/usr/bin/env node
/**
 * **第三方素材声明门禁的破坏性验证**（"它真的会咬吗"）—— R70 · 排查39。
 *
 * 为什么需要这一步：一条永远通过的检查等于没有检查。本轮要证的就是
 * 「`check:notices` 的每一条都能在漂移出现时**真的失败**」——
 * 因为这几条守的是**「声明随副本保留」**这种"缺了不报错、长了不吭声"的性质：
 * 没人引用、没人抄进文档、构建产物里没有，**界面照常显示、测试照常全绿**。
 *
 * 做法（与 `verify-docs-check.mjs` 同形）：备份原文 → 注入一处漂移 → 跑门禁
 * ⇒ 断言**那一条**变红（不是"有红就行"，是"该红的那条红了"）→ 写回原文 → 再跑断言全绿。
 * 全程不落临时文件（`.tmp` 可能被清理），子进程用**异步 spawn**（本环境同步 spawn 不可用）。
 *
 * 用法：node scripts/verify-notices-check.mjs（需要先构建：npm run build）
 * 退出码：0 = 每条都能咬；1 = 有一条没拦住
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

class SelftestAbort extends Error {}

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  throw new SelftestAbort(msg);
};

function gitHead() {
  return new Promise((done) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.on('error', () => done(null));
    child.on('close', () => done(out.trim()));
  });
}

function runCheck() {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/check-notices.mjs'], { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('error', () => done({ code: null, out }));
    child.on('close', (code) => done({ code, out }));
  });
}

/** 某一条检查在输出里是不是红的（✅ 绿 / ❌ 红） */
const checkIsRed = (out, nameFragment) => {
  const line = out.split('\n').find((l) => l.includes(nameFragment));
  if (line === undefined) return false;
  return line.trimStart().startsWith('❌');
};

/* ---------------- 备份 / 还原（含 mtime：还原内容也会刷新 mtime，会误伤"产物比源码旧"那条） ---------------- */
const backups = [];
const backupFile = (rel) => {
  const abs = join(repoRoot, rel);
  const content = readFileSync(abs, 'utf8');
  const mtime = statSync(abs).mtime;
  backups.push({ abs, content, mtime });
  return content;
};
const restoreAll = () => {
  for (const b of backups) {
    writeFileSync(b.abs, b.content);
    utimesSync(b.abs, b.mtime, b.mtime);
  }
  backups.length = 0;
};

const NOTICE_DOC = 'THIRD_PARTY_NOTICES.md';
const ICONS = 'apps/desktop/src/renderer/src/ui/icons.tsx';
const CARD = 'apps/desktop/src/renderer/src/features/notices/NoticesCard.tsx';

/** 构建产物里含那段声明的那个文件（用来注入"分发副本把声明丢了"） */
function bundleHolding(text) {
  const dirs = [
    join(repoRoot, 'apps', 'desktop', 'out', 'renderer', 'assets'),
    join(repoRoot, 'apps', 'desktop', 'out', 'main'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!/\.(js|cjs|mjs)$/.test(name)) continue;
      if (!statSync(full).isFile()) continue;
      if (readFileSync(full, 'utf8').includes(text)) return full;
    }
  }
  return null;
}

/* ---------------- 基线：不注入时门禁必须是绿的 ---------------- */
const base = await runCheck();
if (base.code !== 0) {
  console.error(base.out);
  process.exit(1);
}
const noticeText = readFileSync(join(repoRoot, ICONS), 'utf8').match(
  /export\s+const\s+LUCIDE_NOTICE\s*=\s*\n?\s*'([^']*)'/,
)?.[1];
if (noticeText === undefined) {
  console.error('❌ 源码里找不到 LUCIDE_NOTICE 的声明文本 ⇒ 靶子失效，先修好再跑这个验证');
  process.exit(1);
}
const bundle = bundleHolding(noticeText);
if (bundle === null) {
  console.error('❌ 构建产物里找不到那段声明 ⇒ 靶子失效（先跑 npm run build）');
  process.exit(1);
}

/* ---------------- 逐条注入 ---------------- */
const cases = [
  {
    id: 'N1',
    name: '「真正用上」：把卡片里的引用换成字面量（import 留着 ⇒ 名字还在、声明没进产物）',
    check: '真正用上',
    apply: () => {
      backupFile(CARD);
      const abs = join(repoRoot, CARD);
      const src = readFileSync(abs, 'utf8');
      const next = src.replace('{LUCIDE_NOTICE}', '第三方图标素材声明（此处略）');
      if (next === src) throw new Error('注入靶子没命中（N1）');
      writeFileSync(abs, next);
    },
  },
  {
    id: 'N2',
    name: '「文档逐字」：把声明文档里的版权行改一个字',
    check: '逐字包含',
    apply: () => {
      backupFile(NOTICE_DOC);
      const abs = join(repoRoot, NOTICE_DOC);
      const src = readFileSync(abs, 'utf8');
      const next = src.replace('Cole Bemis 2013-2022', 'Cole Bemis 2013-2023');
      if (next === src) throw new Error('注入靶子没命中（N2）');
      writeFileSync(abs, next);
    },
  },
  {
    id: 'N3',
    name: '「构建产物可查」：把分发副本里那段文字抹掉',
    check: '构建产物里查得到',
    apply: () => {
      const abs = bundle;
      const content = readFileSync(abs, 'utf8');
      backups.push({ abs, content, mtime: statSync(abs).mtime });
      writeFileSync(abs, content.replace(noticeText, 'X'.repeat(noticeText.length)));
    },
  },
  {
    id: 'N4',
    name: '「找得到声明」：把常量改名（`LUCIDE_NOTICE` → `LUCIDE_NOTE`）',
    check: '源码里能找到声明常量',
    apply: () => {
      backupFile(ICONS);
      const abs = join(repoRoot, ICONS);
      const src = readFileSync(abs, 'utf8');
      const next = src.replace(/LUCIDE_NOTICE/g, 'LUCIDE_NOTE');
      if (next === src) throw new Error('注入靶子没命中（N4）');
      writeFileSync(abs, next);
    },
  },
  {
    id: 'N5',
    name: '「产物不比源码旧」：把声明源码的修改时间推到产物之后（量的是旧产物）',
    check: '不比源码旧',
    apply: () => {
      const abs = join(repoRoot, ICONS);
      const mtime = statSync(abs).mtime;
      backups.push({ abs, content: readFileSync(abs, 'utf8'), mtime });
      const future = new Date(Date.now() + 60_000);
      utimesSync(abs, future, future);
    },
  },
  {
    id: 'N6',
    name: '「生成物不许漂」：把依赖许可清单里本仓包的版本改回旧值（生成物停在三轮前没人知道）',
    check: '生成物',
    apply: () => {
      backupFile('docs/DEPENDENCY-LICENSES.md');
      const abs = join(repoRoot, 'docs', 'DEPENDENCY-LICENSES.md');
      const src = readFileSync(abs, 'utf8');
      const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
      const next = src.replace(`- ${pkg.name}@${pkg.version}`, `- ${pkg.name}@0.0.1-stale`);
      if (next === src) throw new Error('注入靶子没命中（N6）');
      writeFileSync(abs, next);
    },
  },
];

const headBefore = await gitHead();

let failed = false;
try {
  for (const c of cases) {
    try {
      c.apply();
    } catch (err) {
      fail(`${c.id} 注入失败：${err instanceof Error ? err.message : String(err)}`);
    }
    const r = await runCheck();
    if (r.code === 0) {
      failed = true;
      console.error(`❌ ${c.id} 没被拦住：${c.name}`);
      console.error(r.out);
    } else if (!checkIsRed(r.out, c.check)) {
      failed = true;
      console.error(`❌ ${c.id} 红了，但不是「${c.check}」那条红（是别的检查红 ⇒ 这条检查可能没牙齿）`);
      console.error(r.out);
    } else {
      console.log(`✅ ${c.id} 被咬住：${c.name}`);
    }
    restoreAll();
    const after = await runCheck();
    if (after.code !== 0) {
      failed = true;
      console.error(`❌ ${c.id} 还原后门禁仍然是红的 ⇒ 还原没生效：`);
      console.error(after.out);
    }
  }
} finally {
  restoreAll();
}

const headAfter = await gitHead();
if (headBefore !== null && headAfter !== null && headAfter !== headBefore) {
  failed = true;
  console.error(`❌ 自检期间 HEAD 变了（${String(headBefore)} → ${String(headAfter)}）⇒ 请人工核一下工作树`);
}

const final = await runCheck();
if (final.code !== 0) {
  failed = true;
  console.error('❌ 全部还原后门禁仍然是红的：');
  console.error(final.out);
}

if (failed) {
  console.error('\n第三方素材声明门禁的破坏性验证：❌ 有检查没咬住');
  process.exit(1);
}
console.log(`\n第三方素材声明门禁的破坏性验证通过：${String(cases.length)} 条注入全部被咬住`);
