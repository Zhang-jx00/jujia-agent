#!/usr/bin/env node
/**
 * **第三方素材声明门禁**（R70 · 排查39）。
 *
 * ## 它守的是什么
 *
 * 「许可证要求**随副本保留**版权声明」这句话，只有在**分发出去的那份东西里查得到**才算兑现。
 * 而本仓踩过的坑正是这一条：
 *   · 素材是**内联进仓库**的（Lucide 的 SVG 路径数据），**不是 npm 依赖** ⇒ `license:check` 看不见它；
 *   · 版权声明写成了源码里的一个**常量** ⇒ 没有任何被分发的代码引用它 ⇒ 打包器**树摇**掉了
 *     ⇒ 实测构建产物 `out/renderer/assets/*.js` 对这段文字 **0 命中** ⇒ 分发副本里一个字都没有；
 *   · 而当时那条单测的标题写着「ISC 要求随副本保留」，实际只断言了「模块里有这个字符串」
 *     ⇒ **判据宣称的覆盖面 ≠ 它实际测到的覆盖面**。
 *
 * ⇒ 本脚本把「随副本保留」拆成四个**能机械判定**的环节，逐条查：
 *
 *   ① **发现**：源码里存在 `export const <素材>_NOTICE = '…'`（少了 ⇒ 定位器失效，先红）
 *   ② **用上**：该常量必须被**非测试**代码 import（只被测试引用 ⇒ 进不了分发副本 ⇒ 等于没保留）
 *   ③ **文档**：`THIRD_PARTY_NOTICES.md` 里必须**逐字**出现同一段声明（两份副本靠对账，不靠自觉）
 *   ④ **分发副本**：构建产物里必须**查得到**这段文字（查不到 ⇒ 不叫「随副本保留」）
 *
 * ## 覆盖不到的地方（如实说明，不吹）
 *
 *   · 它**只认 `*_NOTICE` 常量**这一种登记方式 ⇒ 「新增了素材却压根没写声明」它抓不到
 *     （那是**人的纪律**：新增非代码素材时照 `THIRD_PARTY_NOTICES.md` 末尾那两步做）；
 *   · ④ 只查**构建产物**（`out/`），不查安装包内的 `app.asar` ⇒ 安装包那一层靠 `verify:pack` 兜底。
 *
 * ## 用法
 *
 *   npm run check:notices      （需要先构建：npm run build）
 *   退出码：0 = 通过；1 = 发现问题（逐条打印）
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * **发现规则只写一份**（R73 · 排查42）：「这次该保留的声明是哪些、分别是什么字」要判**两处**
 * —— 构建产物（`out/`，本脚本）与**打包产物**（`app.asar`，`verify:pack` 第①步）。
 * 两处各自写一套正则 ⇒ 两份实现会长出两个答案 ⇒ 某处假绿 ⇒ 所以共用 `scripts/notice-source.mjs`。
 */
import { collectNoticeConstants, collectSourceFiles, stripComments } from './notice-source.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'apps', 'desktop', 'src');
const noticeDoc = join(repoRoot, 'THIRD_PARTY_NOTICES.md');
const outRoot = join(repoRoot, 'apps', 'desktop', 'out');

const problems = [];
const checks = [];
const report = (name, ok, detail) => {
  checks.push({ name, ok });
  if (!ok) problems.push({ name, detail });
};
/**
 * 「本次不适用」—— **不是绿**。
 *
 * 为什么单列一档：有些检查的前提可能整个不存在（比如"一条声明都没找到"时，
 * 就没法比"产物比源码新"）。那种情况下**既不能报绿也不能报红**
 * （报绿 = 恒绿的锁，比没锁更坏；报红 = 把"前提不存在"说成"有问题"），
 * ⇒ 单列一档 `➖`，并在最后**明确报出**"本次有 N 条不适用" ⇒ 读者自己判断。
 */
const skip = (name, reason) => {
  checks.push({ name, ok: true, skipped: true, reason });
};

const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');

const sources = collectSourceFiles(srcRoot);

/* --- ① 发现：源码里所有 `export const <名>_NOTICE = '…'` --- */
/** 发现规则**只写一份**（剥注释 / 字面量还原 / 正则都在 `scripts/notice-source.mjs` 里） */
const notices = collectNoticeConstants(srcRoot);

report(
  '源码里能找到声明常量（`export const <素材>_NOTICE`）',
  notices.length > 0,
  notices.length === 0
    ? '一个都没找到 ⇒ 要么素材声明被删了，要么改名了 ⇒ 本脚本定位器失效（防失焦先红）'
    : `找到 ${String(notices.length)} 条`,
);

/* --- ② 用上：常量必须被非测试代码 import **并真的用上** --- */
{
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
  /** 名字 → 真正用到它的那几个文件 */
  const usedBy = new Map();
  for (const file of sources) {
    const src = stripComments(readFileSync(file, 'utf8'));
    /** 这个文件 import 了哪些名字（类型导入会被编译期擦掉 ⇒ 不算） */
    const imported = new Set();
    for (const m of src.matchAll(importRe)) {
      const clause = m[1].trim();
      if (clause.startsWith('type ')) continue; // `import type` ⇒ 编译期擦掉 ⇒ 不算用上
      const braces = clause.match(/\{([\s\S]*)\}/);
      if (braces === null) continue;
      for (const raw of braces[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name !== '') imported.add(name);
      }
    }
    if (imported.size === 0) continue;
    /**
     * **把 import 语句本身摘掉再看剩下的代码** ——
     * 只查"import 了没有"是**半条锁**：import 了却没在代码里用它（名字留在那儿当摆设），
     * 打包器照样会把它树摇掉 ⇒ 分发副本里还是那句话都没有。
     * （这与 R69 的 M350「查到了 ≠ 画出来了」是同一条纪律。）
     */
    const body = src.replace(importRe, '');
    for (const name of imported) {
      if (!new RegExp(`\\b${name}\\b`).test(body)) continue;
      if (!usedBy.has(name)) usedBy.set(name, []);
      usedBy.get(name).push(file);
    }
  }
  const unused = notices.filter((n) => !usedBy.has(n.name));
  if (notices.length === 0) {
    skip('每个声明常量都被**被分发的代码真正用上**（只 import 不使用 ⇒ 打包时被树摇掉 ⇒ 等于没保留）', '没有声明可比');
  } else {
    report(
      '每个声明常量都被**被分发的代码真正用上**（只 import 不使用 ⇒ 打包时被树摇掉 ⇒ 等于没保留）',
      unused.length === 0,
      unused
        .map(
          (n) =>
            `${n.name}（${rel(n.file)}）只被 import 或只被测试引用 ⇒ 它不会进分发副本`,
        )
        .join('；'),
    );
  }
}

/* --- ③ 文档：THIRD_PARTY_NOTICES.md 里必须逐字出现同一段声明 --- */
{
  const doc = readFileSync(noticeDoc, 'utf8');
  const missing = notices.filter((n) => !doc.includes(n.text));
  if (notices.length === 0) {
    skip('第三方声明文档里逐字包含同一段声明（两份副本靠对账，不靠自觉）', '没有声明可比');
  } else {
    report(
      '第三方声明文档里逐字包含同一段声明（两份副本靠对账，不靠自觉）',
      missing.length === 0,
      missing.map((n) => `${n.name} 的声明在 THIRD_PARTY_NOTICES.md 里找不到逐字相同的副本`).join('；'),
    );
  }
}

/* --- ④ 分发副本：构建产物里必须查得到这段文字 --- */
{
  const bundleDirs = [join(outRoot, 'renderer', 'assets'), join(outRoot, 'main')];
  const bundles = [];
  for (const dir of bundleDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!/\.(js|cjs|mjs)$/.test(name)) continue;
      if (!statSync(full).isFile()) continue;
      bundles.push(full);
    }
  }
  if (notices.length === 0) {
    skip('构建产物里查得到这段声明（查得到才叫「随副本保留」）', '没有声明可比');
  } else if (bundles.length === 0) {
    report(
      '构建产物里查得到这段声明（查得到才叫「随副本保留」）',
      false,
      `构建产物目录不存在或没有 JS：${bundleDirs.map(rel).join(' / ')} ⇒ 先跑 npm run build（量不到就红）`,
    );
  } else {
    const missing = [];
    for (const n of notices) {
      const hit = bundles.some((b) => readFileSync(b, 'utf8').includes(n.text));
      if (!hit) missing.push(`${n.name} 的声明在 ${String(bundles.length)} 个构建产物里 0 命中`);
    }
    report(
      '构建产物里查得到这段声明（查得到才叫「随副本保留」）',
      missing.length === 0,
      missing.join('；'),
    );
  }

  // 产物比源码旧 ⇒ 量的是旧产物（这条不查，第四条就可能在测一个早就过期的 bundle）
  if (bundles.length === 0 || notices.length === 0) {
    skip('构建产物不比源码旧（量的是本轮源码，不是上一轮的 bundle）', '没有可比的两边');
  } else {
    const newestBundle = Math.max(...bundles.map((b) => statSync(b).mtimeMs));
    const newestSource = Math.max(...notices.map((n) => statSync(n.file).mtimeMs));
    report(
      '构建产物不比源码旧（量的是本轮源码，不是上一轮的 bundle）',
      newestBundle >= newestSource,
      `最新产物 ${new Date(newestBundle).toISOString()} 早于最新声明源码 ${new Date(newestSource).toISOString()} ⇒ 重新构建再跑`,
    );
  }
}

/* --- ⑥ 生成物不许漂：依赖许可清单里本仓包的版本必须与 package.json 一致 --- */
{
  const depDoc = join(repoRoot, 'docs', 'DEPENDENCY-LICENSES.md');
  const doc = readFileSync(depDoc, 'utf8');
  const stale = [];
  let checked = 0;
  for (const dir of ['apps', 'packages']) {
    const base = join(repoRoot, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const pj = join(base, name, 'package.json');
      if (!existsSync(pj)) continue;
      const pkg = JSON.parse(readFileSync(pj, 'utf8'));
      if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue;
      checked += 1;
      if (!doc.includes(`${pkg.name}@${pkg.version}`)) {
        stale.push(
          `${pkg.name} 的 package.json 是 ${pkg.version}，而 docs/DEPENDENCY-LICENSES.md 里没有这个版本（生成物没跟着重生成）`,
        );
      }
    }
  }
  report(
    '依赖许可清单（生成物）里本仓包的版本与 package.json 一致（生成物漂了没人知道的那一类）',
    checked > 0 && stale.length === 0,
    stale.join('；'),
  );
}

/* --- 收尾：打印 --- */
for (const c of checks) {
  if (c.skipped === true) console.log(`➖ ${c.name}（本次不适用：${c.reason}）`);
  else console.log(`${c.ok ? '✅' : '❌'} ${c.name}`);
}
const skipped = checks.filter((c) => c.skipped === true).length;
if (problems.length > 0) {
  console.log(`\n发现 ${String(problems.length)} 处问题：`);
  for (const p of problems) console.log(`\n❌ ${p.name}\n     ${p.detail}`);
  process.exit(1);
}
console.log(
  `\n第三方素材声明门禁通过（${String(checks.length)} 条` +
    (skipped > 0 ? `，其中 ${String(skipped)} 条本次不适用` : '') +
    '）：源码有声明 · 被代码真正用上 · 文档逐字一致 · 构建产物可查',
);
