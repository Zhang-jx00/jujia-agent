#!/usr/bin/env node
/**
 * 文档一致性检查（2026-09-23 新增）。
 *
 * 为什么需要它：这个项目里文档写得比代码勤 —— 每轮都写 CHANGELOG / PROGRESS / REVIEW-LOG，
 * 于是"文档说的"和"代码做的"很容易悄悄分叉（此前已出现过：文档写 12 步、实际 13 步；
 * 测试数写 520、实际 533；门禁写"四件套"、实际已六件套）。
 * 这类漂移不会让任何测试变红，却会**让读者（包括未来的我）基于错误信息做判断**。
 *
 * 做法：把**可以从代码/配置机械推导**的事实抽出来，与文档里的声明比对。
 * 刻意只用**正则读文件**而不是引 TypeScript 编译器 —— 这个脚本要在最朴素的环境里也能跑，
 * 而且它查的是"结构性事实"（数量、命令名、链接是否存在），不需要类型信息。
 *
 * 它**不能**查什么（如实说明）：语义是否正确、描述是否清楚、实现是否真的按文档那样做
 * ——那些要靠测试与复核，不能指望这个脚本。
 *
 * 用法：npm run check:docs
 * 退出码：0 = 一致；1 = 发现漂移（逐条打印 文件 / 期望 / 实际）
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const checks = [];

const report = (name, ok, detail) => {
  checks.push({ name, ok });
  if (!ok) problems.push({ name, detail });
};

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
const exists = (rel) => existsSync(join(repoRoot, rel));

const readme = read('README.md');
const progress = read('docs/PROGRESS.md');

/* ------------------------------------------------------------------ *
 * 1. README 里提到的 `npm run <x>` 必须真实存在（根或 desktop）
 * ------------------------------------------------------------------ */

const rootPkg = JSON.parse(read('package.json'));
const desktopPkg = JSON.parse(read('apps/desktop/package.json'));
const allScripts = new Set([
  ...Object.keys(rootPkg.scripts ?? {}),
  ...Object.keys(desktopPkg.scripts ?? {}),
]);

{
  const mentioned = [...readme.matchAll(/npm run ([a-z][a-z0-9:_-]*)/gi)].map((m) => m[1]);
  const unknown = [...new Set(mentioned)].filter((s) => !allScripts.has(s));
  report('README 提到的 npm 脚本都存在', unknown.length === 0, `不存在的脚本：${unknown.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 2. README 里的相对链接目标必须存在（文档最易漂移的地方）
 * ------------------------------------------------------------------ */

{
  const links = [...readme.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|mailto:|#)/.test(href));
  const missing = links.filter((href) => !exists(href.split('#')[0]));
  report('README 相对链接都指向存在的文件', missing.length === 0, `失效链接：${missing.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 3. docs/ 下的文档要在 README 的文档导航里出现（写了文档要能被找到）
 * ------------------------------------------------------------------ */

{
  const docs = readdirSync(join(repoRoot, 'docs')).filter((f) => f.endsWith('.md'));
  // 白名单：内部/过程性文档不要求出现在导航里
  const internal = new Set(['PROGRESS.md', 'PLAN.md', 'TEST-POLICY.md']);
  const missing = docs.filter((f) => !internal.has(f) && !readme.includes(`docs/${f}`));
  report('docs/ 下的文档都在 README 导航里（或已列为内部文档）', missing.length === 0, `未挂出：${missing.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 4. 结构性事实：钩子事件数 / 权限模式数 / e2e 步数
 * ------------------------------------------------------------------ */

{
  const hookTypes = read('packages/agent-core/src/hooks/types.ts');
  const block = /HOOK_EVENTS\s*=\s*\[([\s\S]*?)\]/.exec(hookTypes)?.[1] ?? '';
  const hookCount = [...block.matchAll(/'([a-zA-Z]+)'/g)].length;

  const hooksDoc = read('docs/HOOKS.md');
  const docSaysSeven = /七类事件/.test(hooksDoc + readme + progress);
  report(
    '钩子事件数与文档的"七类"一致',
    hookCount === 7 && docSaysSeven,
    `代码里 ${hookCount} 个事件；文档提到"七类事件"：${docSaysSeven ? '是' : '否'}`,
  );
}

{
  const contracts = read('packages/shared-ipc/src/contracts.ts');
  const enumBlock = /permissionModeSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/.exec(contracts)?.[1] ?? '';
  const modeCount = [...enumBlock.matchAll(/'([a-zA-Z]+)'/g)].length;
  const securityDoc = read('SECURITY.md');
  const mention = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'].every((m) =>
    (modeCount === 5 ? contracts : securityDoc).includes(m),
  );
  report('权限模式数量与实现一致（5 种）', modeCount === 5 && mention, `代码里 ${modeCount} 种`);
}

{
  const e2e = read('apps/desktop/scripts/e2e-ui.mjs');
  const stepCount = [...e2e.matchAll(/^\s*step\(/gm)].length;
  const readmeSays = /e2e[^\n]*?(\d+) 步/.exec(readme)?.[1];
  report(
    'README 里的 e2e 步数与脚本一致',
    readmeSays !== undefined && Number(readmeSays) === stepCount,
    `脚本 ${stepCount} 步；README 写 ${readmeSays ?? '(未写)'} 步`,
  );
}

/* ------------------------------------------------------------------ *
 * 4b. PROGRESS 里的数量也必须与实测一致（轨道回归计划 1 修 S7：此前这块是盲区）
 * ------------------------------------------------------------------ */

{
  // 测试文件数：直接数真实文件，而不是引 vitest（快、且不需要跑测试）
  const countTests = (dir) => {
    let n = 0;
    const walk = (p) => {
      let entries;
      try {
        entries = readdirSync(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.tmp' || e.name === '.trash') continue;
        const full = join(p, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.test.ts')) n += 1;
      }
    };
    walk(join(repoRoot, dir));
    return n;
  };
  const testFiles = countTests('packages') + countTests('apps');
  const statedFiles = /(\d+)\s*个测试文件/.exec(progress)?.[1];
  report(
    'PROGRESS 里的测试文件数与实际一致',
    statedFiles !== undefined && Number(statedFiles) === testFiles,
    `实际 ${testFiles} 个 .test.ts；PROGRESS 写 ${statedFiles ?? '(未写)'}`,
  );

  const e2eSource = read('apps/desktop/scripts/e2e-ui.mjs');
  const e2eSteps = [...e2eSource.matchAll(/^\s*step\(/gm)].length;
  const statedSteps = /e2e[^\n]*?(\d+)\s*步/.exec(progress)?.[1];
  report(
    'PROGRESS 里的 e2e 步数与脚本一致',
    statedSteps !== undefined && Number(statedSteps) === e2eSteps,
    `脚本 ${e2eSteps} 步；PROGRESS 写 ${statedSteps ?? '(未写)'} 步`,
  );
}

/* ------------------------------------------------------------------ *
 * 5. 门禁清单：命令必须真实存在；**"N件套"这类数字只允许出现在 PROGRESS 一处**
 * ------------------------------------------------------------------ */

const GATE = ['typecheck', 'lint', 'test', 'smoke', 'perf', 'e2e', 'check:docs'];
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const expectedCn = CN_NUM[GATE.length];
{
  const gateLine = /[一二三四五六七八九十]件套门禁[^\n]*/.exec(progress)?.[0] ?? '';
  const named = GATE.filter((s) => gateLine.includes(s));
  report(
    'PROGRESS 的门禁清单与 package.json 脚本对齐',
    gateLine !== '' && named.length === GATE.length && gateLine.includes(expectedCn + '件套'),
    `门禁行识别到 ${named.length}/${GATE.length} 项，数量词应为「${expectedCn}件套」：${gateLine.slice(0, 60)}`,
  );

  /**
   * 为什么把"数量"赶进一处：本轮实测，同一件事在 7 个文档里出现了
   * 「四件套 / 五件套 / 七件套」三种说法（门禁其实已经加过两轮）。
   * **数字写在多处必然漂移** —— 所以除 PROGRESS 的权威行外，一律要求写成「门禁全绿」。
   */
  const mdFiles = [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    ...readdirSync(join(repoRoot, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => 'docs/' + f),
  ];
  const violations = [];
  for (const f of mdFiles) {
    const text = read(f);
    for (const m of text.matchAll(/([一二三四五六七八九])件套/g)) {
      const ctx = text.slice(Math.max(0, m.index - 6), m.index + 8).replace(/\n/g, ' ');
      // 「开源三件套」指 LICENSE / SECURITY / CONTRIBUTING，与门禁数量无关
      if (ctx.includes('开源')) continue;
      // PROGRESS 是唯一允许写数量的地方（上面那条已核对它等于实际数量）
      if (f === 'docs/PROGRESS.md' && m[1] === expectedCn) continue;
      violations.push(`${f}：…${ctx.trim()}…`);
    }
  }
  report(
    '除 PROGRESS 外没有"N件套"式数量表述（避免多处漂移）',
    violations.length === 0,
    '请改写成「门禁全绿」并指向 docs/PROGRESS.md 的清单：\n     ' + violations.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

console.log('文档一致性检查\n');
for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}`);
if (problems.length > 0) {
  console.log('\n发现的漂移：');
  for (const p of problems) console.log(`  ❌ ${p.name}\n     ${p.detail}`);
  console.log('\n请修正文档或代码，使两者一致 —— 文档写了不存在的命令/步数，比不写更误导。');
  process.exit(1);
}
console.log('\nDOCS OK：文档里的命令、链接、步数、事件数与代码实际状态一致。');
process.exit(0);
