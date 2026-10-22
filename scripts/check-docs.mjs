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

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
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
  const internal = new Set([
    'PROGRESS.md',
    'PLAN.md',
    'TEST-POLICY.md',
    // 归档文件：由主文件（CHANGELOG/REVIEW-LOG）指针引用，不作为对外导航项
    'CHANGELOG-ARCHIVE.md',
  ]);
  const missing = docs.filter((f) => !internal.has(f) && !readme.includes(`docs/${f}`));
  report('docs/ 下的文档都在 README 导航里（或已列为内部文档）', missing.length === 0, `未挂出：${missing.join(', ')}`);
}

/* ------------------------------------------------------------------ *
 * 3b. 孤儿文档检测（2026-09-23 加，清理要可持续）
 *
 * 规则：`docs/` 与 `review/` 下的 .md 必须**至少被别的文件引用一次**（或用中文名/路径出现在
 * 某处），否则就是"写了没人看得到"的死文档 —— 这类文件越积越多，最后没人敢删。
 * 明确列进 INTERNAL 的除外（过程性文件，允许不被引用）。
 * ------------------------------------------------------------------ */

{
  const INTERNAL = new Set([
    'docs/PROGRESS.md', // 状态权威，被 check-docs 自己读
    'review/REVIEW-LOG.md', // 复核台账，按惯例不互相引用
    'review/TRACK-SWEEP-1.md', // 排查报告，可能只在 CHANGELOG 提及
    'docs/DEPENDENCY-LICENSES.md', // 自动生成
  ]);

  const scanDirs = ['docs', 'review'];
  const mdFiles = [];
  for (const dir of scanDirs) {
    for (const name of readdirSync(join(repoRoot, dir))) {
      if (name.endsWith('.md')) mdFiles.push(`${dir}/${name}`);
    }
  }

  // 引用来源：仓库内所有 .md 的正文（含 README）——用相对路径或文件名匹配
  const allText = [
    readme,
    read('CONTRIBUTING.md'),
    read('SECURITY.md'),
    read('CHANGELOG.md'),
    ...mdFiles.map((f) => read(f)),
  ].join('\n');

  const orphans = mdFiles.filter((f) => {
    if (INTERNAL.has(f)) return false;
    const base = f.split('/')[1] ?? f;
    // 被提到即算被引用（`docs/X.md` 或 `X.md`）
    return !allText.includes(f) && !allText.includes(base);
  });

  report(
    'docs/ 与 review/ 下没有"没人引用"的孤儿文档',
    orphans.length === 0,
    `这些文件没有任何地方引用（要么挂进导航，要么删/归档）：${orphans.join(', ')}`,
  );
}

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
        else if (/\.test\.tsx?$/.test(e.name)) n += 1;  // .tsx = 渲染层组件测试（jsdom）
      }
    };
    walk(join(repoRoot, dir));
    return n;
  };
  const testFiles = countTests('packages') + countTests('apps');
  // 同样锚定「当前规模」行，理由与下面的步数一致：历史行里也各自记过文件数
  const statedFiles = /(\d+)\s*个测试文件/.exec(progress.split('**当前规模**')[1] ?? '')?.[1];
  report(
    'PROGRESS 里的测试文件数与实际一致',
    statedFiles !== undefined && Number(statedFiles) === testFiles,
    `实际 ${testFiles} 个测试文件（.test.ts / .test.tsx）；PROGRESS 写 ${statedFiles ?? '(未写)'}`,
  );

  const e2eSource = read('apps/desktop/scripts/e2e-ui.mjs');
  const e2eSteps = [...e2eSource.matchAll(/^\s*step\(/gm)].length;
  // 必须锚定「当前规模」那一行：历史交付行里也写着各自的步数（如"e2e 19 步含 Git 两步"），
  // 用"第一个匹配"会被历史行抢走 —— 那样检查器报的是"文档不一致"，错的却是检查器自己。
  // 与 §数字只写一处 的口径一致：当前状态只在**当前规模**这一行。
  const statedSteps = /界面级 e2e (\d+)\s*步/.exec(progress)?.[1];
  report(
    'PROGRESS 里的 e2e 步数与脚本一致',
    statedSteps !== undefined && Number(statedSteps) === e2eSteps,
    `脚本 ${e2eSteps} 步；PROGRESS「当前规模」行写 ${statedSteps ?? '(未写)'} 步`,
  );

  /**
   * T82（2026-10-22）：「当前规模」行里**渲染层组件测试**的例数与文件数也要机器盯。
   *
   * 为什么补它：那一行里**只有两格**被盯（测试文件数 · e2e 步数）⇒ **其余数字静默漂**。
   * 本轮实测：真值 **109 例 / 14 个组件文件**，而文档里还写着 **94 例 / 13 个**（差 15 例、一个文件）
   * ⇒ 照抄的下一个接手方会按错数字核。
   *
   * 怎么数：**现扫**渲染层 `.test.tsx`（例数 = 顶层 `it(` 的条数 · 文件数 = 文件个数）——
   * 不引 vitest（快、且不需要跑测试），与上面"测试文件数"那条同口径。
   */
  const rendererRoot = join(repoRoot, 'apps/desktop/src/renderer/src');
  let rendererCases = 0;
  let rendererFiles = 0;
  const walkRenderer = (p) => {
    let entries;
    try {
      entries = readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.tmp' || e.name === '.trash') continue;
      const full = join(p, e.name);
      if (e.isDirectory()) walkRenderer(full);
      else if (e.name.endsWith('.test.tsx')) {
        rendererFiles += 1;
        rendererCases += (read(relative(repoRoot, full)).match(/^\s*it\(/gm) ?? []).length;
      }
    }
  };
  walkRenderer(rendererRoot);
  const scaleRow = progress.split('**当前规模**')[1] ?? '';
  const statedCases = /渲染层组件测试\s*(\d+)\s*例/.exec(scaleRow)?.[1];
  const statedRendererFiles = /渲染层组件测试\s*\d+\s*例（jsdom，\s*(\d+)\s*个组件文件）/.exec(scaleRow)?.[1];
  report(
    'PROGRESS「当前规模」里的渲染层组件测试数与实际一致（T82：其余数字不许静默漂）',
    statedCases !== undefined &&
      Number(statedCases) === rendererCases &&
      statedRendererFiles !== undefined &&
      Number(statedRendererFiles) === rendererFiles,
    `实际 ${String(rendererCases)} 例 / ${String(rendererFiles)} 个组件文件（.test.tsx）；` +
      `PROGRESS 写 ${statedCases ?? '(未写)'} 例 / ${statedRendererFiles ?? '(未写)'} 个`,
  );
}

/* ------------------------------------------------------------------ *
 * 5b. 版本号一致（轨道回归计划 2 · R-07）
 *
 * 此前：`package.json` 0.0.0 · desktop 0.14.0 · CHANGELOG 已到 v0.25.0 —— 三处互不相同，
 * 安装包名字、README 阶段、变更记录对不上号。这里把"应用版本 = 最新变更记录版本"钉住。
 * ------------------------------------------------------------------ */

{
  const desktopVersion = JSON.parse(read('apps/desktop/package.json')).version;
  const latest = /^## \[v(\d+\.\d+\.\d+)/m.exec(read('CHANGELOG.md'))?.[1];
  report(
    '应用版本号 = 最新变更记录版本',
    latest !== undefined && desktopVersion === latest,
    `apps/desktop/package.json = ${String(desktopVersion)}；CHANGELOG 最新 = ${latest ?? '(未找到)'}`,
  );
}

/* ------------------------------------------------------------------ *
 * 5. 门禁清单：命令必须真实存在；**"N件套"这类数字只允许出现在 PROGRESS 一处**
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 3c. 知识库：孤儿文件 + 悬空引用（2026-09-23 加）
 *
 * 排查时在这里抓到过 `findings/F8.md` —— **被索引引用但文件根本不存在**。
 * 这类"点不开的链接"比缺文档更坏：读者会以为是自己权限/路径的问题。
 * ------------------------------------------------------------------ */

{
  const knowRoot = join(repoRoot, 'knowledge');
  const collect = (dir, prefix = '') => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...collect(join(dir, e.name), `${prefix}${e.name}/`));
      else if (e.name.endsWith('.md')) out.push(`knowledge/${prefix}${e.name}`);
    }
    return out;
  };
  const files = existsSync(knowRoot) ? collect(knowRoot) : [];
  const knowIndex = read('knowledge/README.md');
  const allText = [readme, read('docs/PROGRESS.md'), read('docs/LEARNING-MAP.md'), knowIndex].join('\n');

  const orphans = files.filter((f) => {
    const base = f.split('/').pop() ?? f;
    if (f === 'knowledge/README.md' || f === 'knowledge/BRIEF.md') return false; // 入口/任务书
    // `_generated-*.md` 是 `gen_matrix.py` 的**中间产物**（已在 .gitignore 与 cleanup.py 的清理范围内），
    // 按定义就不会被任何索引引用。不豁免的话，"改过覆盖度自评表就重跑 gen_matrix.py"
    // 这个**文档化的维护动作**会立刻让门禁变红 —— 检查器不该和自家约定打架。
    if (base.startsWith('_generated-')) return false;
    return !allText.includes(base);
  });
  report(
    'knowledge/ 下没有被引用的孤儿文件',
    orphans.length === 0,
    `这些知识文件没有任何索引引用它们：${orphans.join(', ')}`,
  );

  // 悬空引用：索引里提到的 .md 必须真实存在（限定在本仓库范围内）
  const referenced = [...knowIndex.matchAll(/([A-Za-z0-9_-]+\.md)/g)].map((m) => m[1]);
  const knownNames = new Set(files.map((f) => f.split('/').pop()));
  // 允许跨目录引用（索引里会写 ../docs/X.md、scripts/x.py 这类）：在仓库内按文件名找一次
  const allRepoFiles = [];
  const walkRepo = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.trash', '.tmp'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walkRepo(full);
      else allRepoFiles.push(e.name);
    }
  };
  walkRepo(repoRoot);
  const anywhere = new Set(allRepoFiles);
  // 约定俗成的文件名：是"概念名"而不是本仓库的文档（工作区指令文件、技能文件等）
  const CONVENTIONAL_NAMES = new Set(['AGENTS.md', 'README.md', 'SKILL.md', 'NOTES.md', 'plugin.json']);
  const dangling = [...new Set(referenced)].filter(
    (name) =>
      !CONVENTIONAL_NAMES.has(name) && !knownNames.has(name) && !anywhere.has(name) && !existsSync(join(repoRoot, name)),
  );
  report(
    'knowledge/README.md 里引用的文件都存在（无悬空引用）',
    dangling.length === 0,
    `索引提到但并不存在：${dangling.join(', ')}`,
  );
}

/**
 * M 状态行的**受控词表**（2026-09-29 复核 046 给的中间步）：
 * 每条 `| M<号> |` 的状态列必须带三态词之一 —— ✅ 已落地 / 🔶 部分 / ⏳ 未开始。
 *
 * 先说清它**不**做什么：它不判"状态与事实是否匹配"（那件事继续靠人工判断 +
 * 像上面 `PDF_OPEN` 那样按能力逐条立的条件断言）。它抓的是最常见的那一类漂移：
 * 某行压根没写状态词、或者自造了一个表外词 —— 这类问题占大多数，而且能机器判。
 */
{
  const rows = read('docs/TRACK-ROADMAP.md')
    .split('\n')
    .filter((l) => /^\| M\d+ \|/.test(l));
  const missing = rows
    .filter((l) => {
      const status = (l.split('|')[3] ?? '').trim();
      return !(status.includes('✅') || status.includes('🔶') || status.includes('⏳'));
    })
    .map((l) => (l.split('|')[1] ?? '').trim());
  report(
    `里程碑状态行都用了受控词表（✅/🔶/⏳，共 ${String(rows.length)} 行）`,
    rows.length > 0 && missing.length === 0,
    `缺状态词的里程碑：${missing.join('、') || '(无)'}`,
  );
}

/**
 * 十条轨道的**受控词表**（与 `docs/TRACK-PLANS.md` §一 同源，逐词核对它真实存在，
 * 免得词表在两处漂移 —— 这是"凡枚举现状的锁一律现扫、不写死清单"那条纪律的例外处理：
 * 词表本身是**规范**不是**现状**，但它的**拼写**必须与文档一致，所以仍要机器交叉核对）。
 * 多处检查共用：CHANGELOG 标题轨道段 / 复核台账标题 / 标签格式。
 */
const TRACK_WORDS = ['回归', '铺设', '扩容', '拓展', '加固', '升级', '优化', '规整', '排查', '接驳'];

/** 语义化版本比较 a > b（三处检查共用："历史不回改"的豁免边界都靠它） */
const verAbove = (a, b) =>
  a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));

/**
 * glob → 正则：结尾带斜杠的双星号跨任意层目录、裸双星号跨任意字符、单星号只跨一层、`?` 单字符，其余按字面。
 * 两处共用：归轨索引的条目匹配、测试收集范围的核对。
 * 手写而不是引库，是为了让这个脚本仍然"任何一台装 node 的机器都能跑"。
 * （注释里刻意不出现那个"双星号加斜杠"的连写 —— 它会把这段块注释当场截断，
 * 而且截断是**静默**的：脚本会一路语法错误到几百行之外才炸。这条我自己踩过一次，见复核 053。）
 */
const globToRe = (glob) => {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          out += '(?:[^/]+/)*';
        } else out += '.*';
      } else out += '[^/]*';
      continue;
    }
    out += '.+^${}()|[]\\'.includes(c) ? '\\' + c : c;
  }
  return new RegExp('^' + out + '$');
};

/**
 * CHANGELOG 标题的**轨道段**必须命中十条轨道的受控词表（2026-10-05 复核 047 的补账要求）。
 *
 * 为什么立它：标题曾长期只有任务号 —— `v0.46.0-M19a`、`v0.45.0-T22`、`v0.50.0-M9a`。
 * 任务号回答"这是哪一批"，轨道词（扩容 / 接驳 / 规整…）回答"这属于哪类工作"；两者不是一回事，
 * 缺了轨道段，按轨道的统计与检索就做不了。词表与 `docs/TRACK-PLANS.md` §一 的十条轨道同源，
 * 并逐词核对它在文档里真实存在（免得词表两处漂移，同"现扫不写死"的纪律）。
 *
 * 边界（历史不回改）：≤ v0.50.0 的标题按当时约定写成任务号，**一个字不改**；
 * 新规自 **v0.51.0** 起生效 —— 标题的轨道段里至少要出现一个受控轨道词。
 */
{
  const plans = read('docs/TRACK-PLANS.md');
  const missingVocab = TRACK_WORDS.filter((t) => !plans.includes(t));
  const titles = [...read('CHANGELOG.md').matchAll(/^## \[v(\d+)\.(\d+)\.(\d+)-([^\]]+)\]/gm)].map((m) => ({
    v: [Number(m[1]), Number(m[2]), Number(m[3])],
    suffix: m[4],
  }));
  const FLOOR = [0, 50, 0]; // ≤ v0.50.0 = 历史（不回改）；自 v0.51.0 起按新规
  const bad = titles.filter((t) => verAbove(t.v, FLOOR) && !TRACK_WORDS.some((w) => t.suffix.includes(w)));
  report(
    'CHANGELOG 标题的轨道段命中受控词表（v0.51.0 起；历史标题不回改）',
    missingVocab.length === 0 && titles.length > 0 && bad.length === 0,
    missingVocab.length > 0
      ? `词表与 TRACK-PLANS.md 对不上（缺：${missingVocab.join('、')}）`
      : `缺轨道词的标题：${bad.map((t) => t.suffix).join('、') || '(无)'}`,
  );
}

/**
 * M 状态行与代码事实的同步（2026-09-29 复核 046 顺手抓到的文档滞后）：
 * TRACK-ROADMAP 的 M10 行当时还写着"PDF 查看随 M19 做"，而 PDF 查看（M19b）早已交付 ——
 * 能力表有机器交叉断言，**里程碑状态行却没有**。
 *
 * 这里先把**能机器判**的那一条立起来：通道表里有 `PDF_OPEN` ⇒ M10 行不许再说"只剩 PDF"。
 * （通用的"M 状态全量同步"得先给状态行定一个可解析格式，登记为后续项，不在本轮凭空想象。）
 */
{
  const channelsSrc = read('packages/shared-ipc/src/channels.ts');
  const roadmapSrc = read('docs/TRACK-ROADMAP.md');
  const pdfShipped = channelsSrc.includes('PDF_OPEN:');
  const m10Line = roadmapSrc.split('\n').find((l) => l.startsWith('| M10 |')) ?? '';
  report(
    'M10 状态行与代码事实一致（PDF 查看交付后不许再写"只剩 PDF"）',
    !pdfShipped || /已交付/.test(m10Line) || !/PDF/.test(m10Line),
    `M10 行：${m10Line.slice(0, 90)}`,
  );
}

/* ------------------------------------------------------------------ *
 * 4. 结构性事实：钩子事件数 / 权限模式数 / e2e 步数
 * ------------------------------------------------------------------ */

/**
 * 门禁分**两档**（2026-09-29 复核 044 的流程建议：成本与收益匹配）。
 * - 快档 —— 每次提交前跑：`typecheck / lint / test / check:docs / e2e`
 *   （都快，而且这几类改动每轮都碰得到）；
 * - 慢档 —— 阶段收尾或发版前跑：`smoke / perf / verify:pack / mut`
 *   （验的是打包配置、启动行为、变异覆盖 —— 这些**不会每轮都变**，每轮跑的边际价值低、成本高）。
 * "全绿才打标签"据此改为"**快档全绿才打标签**，慢档在阶段收尾与发版前全绿"。
 * 这里盯两件事：① 两条档位行都要**点名自己那一档的全部脚本**（少写一个就是清单漂了）；
 * ② 档位之外的地方仍然不许写数量词（沿用下面那条"数量只许出现在 PROGRESS"的规则）。
 */
const GATE_FAST = ['typecheck', 'lint', 'test', 'check:docs', 'e2e'];
const GATE_SLOW = ['smoke', 'perf', 'verify:pack', 'mut'];
{
  /**
   * R24 机械化：这几条判据此前取"全文第一处出现"——于是"慢档字样抢在门禁定义行之前"
   * 这种事会把识别结果整个带偏，报出来的却是一句不知所云的"识别到 0/5"（R20/R13 各咬一次）。
   * 现在两步走：① **找定义行**（含"门禁"或点名 ≥3 个脚本的那一行）；② **定义行之前不许
   * 出现这两个字样** —— 犯了就点名"第几行、写了什么、怎么改"，直指病灶。
   */
  const gateLines = progress.split('\n');
  const findDef = (word, scripts) => {
    // ① 先按"点名 ≥3 个脚本"认定义行（定义行的硬特征）；
    //    ② 没有再看含"门禁"的行（宽松兜底）；③ 再退第一处出现。
    // R24 收口实测：宽松口径（'门禁' 也算）会被正文里「门禁机械化…」这种标题词骗走 —— 收紧之。
    for (let i = 0; i < gateLines.length; i += 1) {
      const l = gateLines[i] ?? '';
      if (l.includes(word) && scripts.filter((s) => l.includes(s)).length >= 3) return { idx: i, line: l };
    }
    for (let i = 0; i < gateLines.length; i += 1) {
      const l = gateLines[i] ?? '';
      if (l.includes(word) && l.includes('门禁')) return { idx: i, line: l };
    }
    const fi = gateLines.findIndex((l) => (l ?? '').includes(word));
    return { idx: fi, line: fi >= 0 ? (gateLines[fi] ?? '') : '' };
  };
  const fastDef = findDef('快档', GATE_FAST);
  const slowDef = findDef('慢档', GATE_SLOW);
  const fastNamed = GATE_FAST.filter((s) => fastDef.line.includes(s));
  const slowNamed = GATE_SLOW.filter((s) => slowDef.line.includes(s));
  const early = [];
  for (const [word, def] of [['快档', fastDef], ['慢档', slowDef]]) {
    for (let i = 0; i < def.idx; i += 1) {
      if ((gateLines[i] ?? '').includes(word)) {
        early.push(`第 ${i + 1} 行「${word}」：${(gateLines[i] ?? '').slice(0, 60)}`);
      }
    }
  }
  report(
    'PROGRESS 的按档门禁清单与 package.json 脚本对齐（字样不许抢在定义行之前）',
    fastNamed.length === GATE_FAST.length && slowNamed.length === GATE_SLOW.length && early.length === 0,
    [
      `定义行：快档 第 ${fastDef.idx + 1} 行（识别 ${fastNamed.length}/${GATE_FAST.length}）；` +
        `慢档 第 ${slowDef.idx + 1} 行（识别 ${slowNamed.length}/${GATE_SLOW.length}）`,
      early.length > 0
        ? '字样出现在定义行**之前**（R20/R13 的复发形态）——把引用改成「图形类门禁与全量变异」或移到定义行之后：\n     ' +
          early.join('\n     ')
        : '',
    ]
      .filter(Boolean)
      .join('\n     '),
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
      // **历史归档不算漂移**：归档里保留着当时的说法（"四件套""五件套"），
      // 那是审计轨迹，改掉反而破坏证据。规则只约束"活的文档"。
      .filter((f) => !f.includes('ARCHIVE'))
      .map((f) => 'docs/' + f),
  ];
  const violations = [];
  for (const f of mdFiles) {
    const text = read(f);
    for (const m of text.matchAll(/([一二三四五六七八九])件套/g)) {
      const ctx = text.slice(Math.max(0, m.index - 6), m.index + 8).replace(/\n/g, ' ');
      // 「开源三件套」指 LICENSE / SECURITY / CONTRIBUTING，与门禁数量无关
      if (ctx.includes('开源')) continue;
      // PROGRESS 是唯一允许写数量/档位清单的地方（上面那条已核对它与脚本集合一致）
      if (f === 'docs/PROGRESS.md') continue;
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
 * 6. IPC 通道数：文档/注释若写了数字，必须与 `channels.ts` 一致
 *
 * 为什么加：交接验收抓到"33 个通道"这个常数同时写在两处**源码注释**和交接文档里，
 * 而通道早就加到了更多 —— 通道是**只会增加**的东西，写死数字必漂。
 * 治本做法是文档不写数字（改成"清单以 channels.ts 为准"）；这条检查负责保证
 * **一旦有人再写数字，它必须是对的**。
 * ------------------------------------------------------------------ */

const channelsSource = read('packages/shared-ipc/src/channels.ts');
const ipcBody = /export const IPC = \{([\s\S]*?)\n\}/.exec(channelsSource)?.[1] ?? '';
const CHANNEL_COUNT = [...ipcBody.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*'/gm)].length;

/* ------------------------------------------------------------------ *
 * 7. 对标产品名：活文档与源码注释里必须 0 命中
 *
 * 项目所有者的固定约定：**对外不写"参考/借鉴 XX 项目"**，学到的东西内化成
 * "我们为什么这样做"，痕迹只留内部私有目录。仓库是公开的，所以这条要机器管 ——
 * 此前一轮"去参考化"人工检索声称 0 命中，实际漏了 20 多处变体写法。
 *
 * **为什么这里只存哈希、不存名字**：这条规则要求"全仓 0 命中"，
 * 如果把被禁的名字写进脚本，那么**守约的工具自己就成了违禁词的出现位置**，
 * "全仓 0 命中"就得永远挂一个白名单例外 —— 而例外是会繁殖的东西。
 * 存 SHA-256 前 12 位（按小写比较），名字本身、清洗原因与背景见
 * `review/REVIEW-LOG.md` 复核 013 / 025 与项目记忆；**本注释里同样不写原名**。
 * 第二条是给 `verify-docs-check.mjs` 用的**哨兵**（注入它来证明这条检查真的会咬），不是产品名。
 * 加新名字的方法：`node -p "require('crypto').createHash('sha256').update('名字'.toLowerCase()).digest('hex').slice(0,12)"`
 * ------------------------------------------------------------------ */

/** 命中判定 = 长度粗筛 + 摘要比对（长度非敏感信息，避免对整仓每个词都做哈希） */
const BLOCKED_NAME_DIGESTS = [
  { len: 3, h: '281aca1a80b5' },
  { len: 22, h: 'c4771baf8437' },
];
const digest12 = (s) => createHash('sha256').update(s.toLowerCase(), 'utf8').digest('hex').slice(0, 12);

/** 仓库内需要扫描的活文件（排除依赖、产物、回收站与历史归档） */
const walkLiveFiles = (exts) => {
  const SKIP_DIRS = new Set(['node_modules', '.git', '.trash', '.tmp', 'out', 'dist', 'release', 'coverage']);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = relative(repoRoot, full).split('\\').join('/');
        if (rel.includes('ARCHIVE')) continue; // 历史归档是审计轨迹，不改也不扫
        if (!exts.some((x) => e.name.endsWith(x))) continue;
        out.push(rel);
      }
    }
  };
  walk(repoRoot);
  return out;
};

{
  // 本脚本已改为只存哈希，**不再需要自我豁免**；
  // 只有 verify-docs-check.mjs 仍豁免 —— 它必须含哨兵字面量才能注入测试。
  const SELF = new Set(['scripts/verify-docs-check.mjs']);
  const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
  const hits = [];
  for (const rel of walkLiveFiles(['.md', '.ts', '.tsx', '.js', '.mjs', '.cjs'])) {
    if (SELF.has(rel)) continue;
    const text = read(rel);
    for (const m of text.matchAll(TOKEN_RE)) {
      const tok = m[0];
      if (!BLOCKED_NAME_DIGESTS.some((b) => b.len === tok.length)) continue; // 长度粗筛
      const d = digest12(tok);
      if (BLOCKED_NAME_DIGESTS.some((b) => b.len === tok.length && b.h === d)) {
        hits.push(`${rel}:${String(text.slice(0, m.index).split('\n').length)}`);
      }
    }
  }
  report(
    '活文档与源码注释里没有对标产品名（内化成"我们为什么这样做"）',
    hits.length === 0,
    `命中 ${String(hits.length)} 处（**只给位置，不回显命中的名字**）：${hits.slice(0, 12).join(', ')}${hits.length > 12 ? ' …' : ''}`,
  );
}

{
  // 谁写了"N 个通道"就必须写对；没写数字是最推荐的（以 channels.ts 为准）。
  // 豁免：① CHANGELOG 与 review/ 是**历史审计轨迹**（记录的是当时的通道数），按约定不改写；
  //      ② 本脚本与它的自检脚本 —— 自检要**故意注入一个错的数字**来证明检查会咬。
  const claimRe = /(\d+)\s*(?:个\s*)?(?:IPC\s*)?通道/g;
  const AUDIT_TRAIL = (rel) => rel === 'CHANGELOG.md' || rel.startsWith('review/');
  const SELF = (rel) => rel === 'scripts/check-docs.mjs' || rel === 'scripts/verify-docs-check.mjs';
  const wrong = [];
  for (const rel of walkLiveFiles(['.md', '.ts', '.tsx', '.js', '.mjs'])) {
    if (SELF(rel) || AUDIT_TRAIL(rel)) continue;
    const text = read(rel);
    for (const m of text.matchAll(claimRe)) {
      if (Number(m[1]) !== CHANNEL_COUNT) {
        const line = text.slice(0, m.index).split('\n').length;
        wrong.push(`${rel}:${line} 写「${m[0].trim()}」`);
      }
    }
  }
  report(
    'IPC 通道数：文档/注释里写的数字与 channels.ts 一致',
    CHANNEL_COUNT > 0 && wrong.length === 0,
    `channels.ts 实际 ${CHANNEL_COUNT} 个；不一致的声明：${wrong.join('；') || '(无)'}`,
  );
}

/* ------------------------------------------------------------------ *
 * 8. 能力表交叉断言：README 标 ✅ 的能力必须真有运行期通路
 *
 * 为什么加：交接验收抓到两条"能力被高估"——git 模块整块未接线却标 ✅、
 * 以及把"能跑命令"写成模型的内置能力（实际内置工具只有读/写/列目录三个）。
 * 这类漂移最伤项目可信度（本项目的立身之本是"说了没做就是没做"），
 * 而它**不会让任何测试变红** —— 所以在这里把它和代码事实钉在一起：
 *   ① ✅ 行里出现的工具名，必须真的在工具清单里；
 *   ② ✅ 行若声称 git 能力，必须存在 GIT_* IPC 通道（= 真的接了线）。
 * ------------------------------------------------------------------ */

{
  const TOOL_SOURCES = [
    'packages/agent-core/src/tools/builtin/file-tools.ts',
    'packages/agent-core/src/tools/builtin/exec-tool.ts',
    'packages/agent-core/src/tools/builtin/note-tool.ts',
    'packages/agent-core/src/skills/tool.ts',
    'packages/agent-core/src/loop/agent-loop.ts',
  ];
  const toolNames = new Set();
  for (const f of TOOL_SOURCES) {
    const text = read(f);
    for (const m of text.matchAll(/name:\s*'([a-z][a-z0-9_]*)'/g)) toolNames.add(m[1]);
    for (const m of text.matchAll(/_TOOL_NAME\s*=\s*'([a-z][a-z0-9_]*)'/g)) toolNames.add(m[1]);
  }

  const section = /## 当前能力([\s\S]*?)\n## /.exec(readme)?.[1] ?? '';
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[-\s|]+\|$/.test(l) && !l.includes('能力 | 状态'))
    .filter((l) => l.includes('✅'));

  const badTools = [];
  const badBacking = [];
  for (const row of rows) {
    // 只认"整个反引号内容就是一个工具名"的写法，避免把 `.env`、`npm run e2e` 当成工具
    for (const m of row.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      if (!toolNames.has(m[1])) badTools.push(`「${m[1]}」不在实际工具清单里`);
    }
    if (/\bgit\b/i.test(row) && !/\bGIT_[A-Z]/.test(channelsSource)) {
      badBacking.push('声称 git 能力 ✅，但 channels.ts 里没有任何 GIT_* 通道（= 未接线）');
    }
  }

  report(
    'README 能力表标 ✅ 的项都有真实运行期通路（工具名 / IPC 通道交叉核对）',
    rows.length > 0 && toolNames.size > 0 && badTools.length === 0 && badBacking.length === 0,
    [
      `实际工具清单：${[...toolNames].join(', ') || '(空)'}`,
      `标 ✅ 的能力行：${rows.length} 行`,
      badTools.length > 0 ? `工具名对不上：${badTools.join('；')}` : '',
      badBacking.length > 0 ? `缺运行期通路：${badBacking.join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 9. 本机绝对路径：代码与配置里不许出现"这台机器上仓库在哪"的字面量
 *
 * 为什么加：PROGRESS 的开源就绪表一直写着"源码无本机绝对路径 ✅ 已审计"，
 * 但交接验收在 `scripts/` 里找到 6 处写死的 checkout 路径 —— 别人 clone 下来那些脚本直接跑不了，
 * 违反工程底线"不得依赖本机特殊状态才能跑"。这条把它变成机器断言。
 *
 * 判据是**运行时算出来的**（当前仓库根 + 当前用户主目录），
 * 因为把某台机器的路径写成字面量正则，等于让检查器自己带上一个本机绝对路径 ——
 * 与 §7 改用哈希是同一个道理：**守约的工具不能自己成为违约现场**。
 * 也**不用**通用的 `C:\Users\` 形态做判据：那样会被安全文档里的示例路径误伤
 * （`path-guard.ts` 就用 `C:\Users\...\id_rsa` 举例说明越界写盘的风险），
 * 误伤三次之后人就学会忽略红灯了。用"这台机器的家目录全路径"判，precision 高且零误报。
 * 只扫代码与配置，不扫 .md —— 台账与变更记录需要引用路径作为证据。
 * ------------------------------------------------------------------ */

{
  /**
   * 判据要点（**规整17 补的两个洞**，2026-10-15 开源预演复跑抓到）：
   *
   * ① 源码里的 Windows 路径是**转义过的**（写成 `D:\\MiMo\\…`），旧判据把 `\`→`/` 之后再比，
   *    得到的是 `D://MiMo//…` —— 与运行时算出的 `D:/MiMo/…` **对不上**。
   *    结果：`mcp-real-server.test.ts` 里那处写死的本机路径在门禁里**隐身了好几轮**，
   *    这条一直报 ✅。典型的"锁读不到真值"：判据的归一化方式与真实写法不一致。
   * ② 只比"仓库根"这一层也不够。同一处写的是**仓库根的上级目录**，
   *    换台机器同样不存在（新克隆的人开了 `JUJIA_NET_TEST` 就跑不通），但字面量永远咬不到它。
   *
   * 修法：**比较前把所有分隔符摘掉**（`\` 与 `/` 都不参与判断），任何转义形态都归一到同一串；
   *      needle 取**运行时真值的三层**：仓库根、仓库根的上级、用户主目录。
   *      摘掉分隔符后仍是一段这台机器特有的长串（含盘符与用户名），误报空间可忽略 ——
   *      判据仍然全部运行时算出，脚本自身不落任何本机路径字面量（§7 的同一条道理）。
   */
  const stripSep = (s) => s.split('\\').join('').split('/').join('');
  const needles = [
    { label: '写死了本机仓库绝对路径', value: stripSep(repoRoot) },
    { label: '写死了本机仓库的上级目录（换台机器同样不存在）', value: stripSep(resolve(repoRoot, '..')) },
    { label: '写死了本机用户主目录（连用户名一起泄漏进公开仓库）', value: stripSep(homedir()) },
  ].filter((n) => n.value.length > 3);
  const CODE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.json', '.yml', '.yaml', '.css', '.html'];
  const hits = [];
  for (const rel of walkLiveFiles(CODE_EXTS)) {
    if (rel === 'package-lock.json') continue; // 依赖锁由 npm 生成，不在本规则范围内
    const hay = stripSep(read(rel));
    for (const n of needles) {
      if (hay.includes(n.value)) {
        hits.push(`${rel}：${n.label}`);
        break;
      }
    }
  }
  report(
    '代码与配置里没有本机绝对路径（别人 clone 下来就能跑）',
    hits.length === 0,
    `命中 ${String(hits.length)} 处：${hits.join('；')}`,
  );
}

/* ------------------------------------------------------------------ *
 * 9b. 活文档（.md）里不许出现**本机用户主目录**（隐私类，与 9 是两回事）
 *
 * 为什么要单独一条：第 9 条只扫代码与配置，.md 不在范围内 —— 理由是台账需要引用路径作证据
 * （CHANGELOG / REVIEW-LOG 里就有几处本机 checkout 路径，那是审计轨迹，删了反而破坏可核验性）。
 * 但"证据里可以有仓库路径"**不等于**"可以把开发者的 Windows 用户名写进文档"：
 * 后者是隐私，且 F-21 那次真实泄漏就是从 .md 的描述里被引用出来的。
 * 所以这条只禁**家目录全路径**（含用户名那一层），不禁仓库路径。实测零误报：全仓 67 个 .md 命中 0。
 *
 * 判据同样是运行时算出来的 homedir()，源码里不含任何本机路径字面量。
 * ------------------------------------------------------------------ */

{
  const norm = (s) => s.split('\\').join('/');
  const homeLit = norm(homedir()).toLowerCase();
  const mdHits = [];
  if (homeLit !== '' && homeLit !== '/') {
    for (const rel of walkLiveFiles(['.md'])) {
      const text = norm(read(rel)).toLowerCase();
      if (text.includes(homeLit)) mdHits.push(rel);
    }
  }
  report(
    '活文档（.md）里没有本机用户主目录（用户名不外泄；仓库路径作证据引用不受此限）',
    mdHits.length === 0,
    `命中 ${String(mdHits.length)} 个文件：${mdHits.join('；')}`,
  );
}

/* ------------------------------------------------------------------ *
 * 10. 归轨索引必须覆盖每一个源码目录（规整11 护栏① · 2026-10-08）
 *
 * 为什么立它（也是三条里最重要的一条）：`docs/TRACK-PLANS.md` §2.1 的归轨索引是一份**清单**。
 * 清单的失败模式不是"写错一行"，而是**悄悄不再完整** —— 新一轮交付新建了目录，
 * 索引没人补，于是"按轨道检索代码"这件事从那天起就在漏东西，而且**漏了不报错**。
 * 所以这里不看索引写了什么，只看**代码实际有哪些目录**（现扫），
 * 一个都没登记过的目录就是红灯 —— 这正是"凡枚举现状的锁一律现扫、不写死清单"那条纪律。
 *
 * 判据（与 §2.1 的三条口径一一对应）：
 * - 扫 `apps/` 与 `packages/` 下的代码文件（`.ts/.tsx/.js/.mjs/.cjs`，
 *   依赖 / 产物 / 临时 / 回收站由 `walkLiveFiles` 剥掉）；
 * - **目录级**要求：含源文件的目录必须被某个条目盖住（条目以 `/` 结尾 = 整目录；
 *   也可能只登记了目录里的具体文件 —— 那样这个目录也算登记过）；
 * - **全是测试文件的目录豁免**：口径③"测试跟随被测对象，不单独列" ——
 *   硬要登记它等于逼双计，反而破坏口径。
 *
 * 防失焦：条目数下限（索引被清空 / 段落标题被改名时必须红，而不是"零条目 = 零违规"）。
 * ------------------------------------------------------------------ */

{
  const plans = read('docs/TRACK-PLANS.md');
  /**
   * 段落定位要求 `### 2.1` 后面**紧跟空白**（整词边界），不能用 `indexOf('### 2.1')`：
   * 第一版用 indexOf，实验把标题改成 `### 2.1x …` 后护栏**照样绿** —— 前缀还在就匹配到了。
   * 同一族教训已在 CSS 版接线锁上踩过一次（子串检查对"改名保前缀"不敏感，M89 逼出整词版）。
   */
  const headRe = /^### 2\.1[ \t]/m;
  const hm = headRe.exec(plans);
  const from = hm === null ? -1 : hm.index;
  const to = plans.indexOf('\n## 三、', from);
  const section = from >= 0 && to > from ? plans.slice(from, to) : '';

  const isPathCell = (s) => /^(apps|packages|scripts|review)\//.test(s) && !/\s/.test(s);
  /** 条目 = 表格行里反引号包住的代码路径；`{a,b}` 就地展开（索引里不嵌套花括号） */
  const entries = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const cell = m[1];
      const brace = /\{([^{}]*)\}/.exec(cell);
      if (brace === null) {
        if (isPathCell(cell)) entries.push(cell);
        continue;
      }
      for (const alt of brace[1].split(',')) {
        const p = cell.replace(brace[0], alt.trim());
        if (isPathCell(p)) entries.push(p);
      }
    }
  }

  const fileCovered = (rel) =>
    entries.some((e) =>
      e.endsWith('/')
        ? rel.startsWith(e)
        : e.includes('*')
          ? globToRe(e).test(rel)
          : rel === e,
    );
  const dirCovered = (dir) => entries.some((e) => e.endsWith('/') && (dir === e || dir.startsWith(e)));

  const codeFiles = walkLiveFiles(['.ts', '.tsx', '.js', '.mjs', '.cjs']).filter((rel) =>
    /^(apps|packages)\//.test(rel),
  );
  const isTestFile = (rel) => /\.test\.(ts|tsx|js|mjs|cjs)$/.test(rel) || rel.includes('/__tests__/');

  const dirs = new Map();
  for (const rel of codeFiles) {
    const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
    const rec = dirs.get(dir) ?? { nonTest: 0 };
    if (!isTestFile(rel)) rec.nonTest += 1;
    dirs.set(dir, rec);
  }

  const uncovered = [];
  for (const [dir, rec] of dirs) {
    if (dirCovered(dir)) continue;
    if (rec.nonTest === 0) continue; // 纯测试目录：口径③跟随被测对象
    // 目录本身没被整条登记，但里面的源文件逐个登记过 —— 也算覆盖
    if (codeFiles.some((f) => f.startsWith(dir) && !isTestFile(f) && fileCovered(f))) continue;
    uncovered.push(dir);
  }

  report(
    `归轨索引（TRACK-PLANS §2.1）覆盖每一个源码目录（现扫 ${String(dirs.size)} 个目录，条目 ${String(entries.length)} 条）`,
    section !== '' && entries.length > 10 && codeFiles.length > 0 && uncovered.length === 0,
    section === ''
      ? 'TRACK-PLANS.md 里找不到 `### 2.1` 这一段（护栏的靶子没了）'
      : entries.length <= 10
        ? `索引条目只有 ${String(entries.length)} 条，少于下限 10 —— 段落被清空？`
        : `未登记的目录 ${String(uncovered.length)} 个：${uncovered.sort().join('、')}`,
  );
}

/* ------------------------------------------------------------------ *
 * 11. 复核台账的**每条标题**要带轨道号（规整11 护栏②）
 *
 * 为什么立它：轨道号是"这批活属于哪条计划"的唯一检索键。CHANGELOG 标题已经有⑨（旧）那条盯，
 * 但**复核台账**没有 —— 而所有者按轨道统计时两边都要读。
 * 词表**现扫**自 TRACK-PLANS（复用上面同一条交叉核对，不在此重复写死第二份清单）。
 *
 * 边界（历史不回改）：**复核 050 起**才要求。049 及以前的标题按当时约定写，一个字不改。
 * 防失焦：至少找到 5 条标题，且**确实检查过 ≥ 050 的那几条**（`checked > 0`）——
 * 否则"正则改坏了、一条都没匹配上"会读成全绿。
 * ------------------------------------------------------------------ */

{
  const log = read('review/REVIEW-LOG.md');
  const heads = [...log.matchAll(/^## 复核 (\d+)(.*)$/gm)].map((m) => ({
    n: Number(m[1]),
    title: m[2],
  }));
  const FLOOR = 50; // 复核 050 起按新规；049 及以前 = 历史
  const recent = heads.filter((h) => h.n >= FLOOR);
  const bad = recent.filter((h) => !TRACK_WORDS.some((w) => h.title.includes(w)));
  report(
    `复核台账标题带轨道词（复核 ${String(FLOOR)} 起；现扫 ${String(heads.length)} 条标题、其中 ${String(recent.length)} 条受新规）`,
    heads.length >= 5 && recent.length > 0 && bad.length === 0,
    recent.length === 0
      ? `没找到编号 ≥ ${String(FLOOR)} 的复核标题（台账格式变了？护栏要跟着改）`
      : `缺轨道词的复核标题：${bad.map((h) => `复核 ${String(h.n).padStart(3, '0')}`).join('、')}`,
  );
}

/* ------------------------------------------------------------------ *
 * 12. CHANGELOG 的「回退点」标签：格式合规 + 真实存在（规整11 护栏③）
 *
 * 为什么立它：这不是假想风险 —— 本轮实测抓到一处**幽灵标签**：文档写"回退点 `v0.24.0-回归1`"，
 * 而真实标签是 `v0.24.0-hg1`。**"按标签回退"是本项目的安全网，指向不存在的标签等于没有安全网**，
 * 而且它只在人最需要它的那一刻（出事想回退）才暴露。
 *
 * 两个判据：
 * - **存在性**：用 `git tag --list` 现扫（又一次"现扫不写死"）。
 *   **读不到 git 时跳过存在性、只查格式** —— 检查器不能在自己跑不了时谎报"标签丢了"。
 * - **格式**：新规矩（复核 049 之后、v0.54.0 起）"标签只取轨道段"= `vX.Y.Z-<轨道词><流水号>`，
 *   不带任务号后缀。≤ v0.53.0 的历史标签不回改，所以**不检查**。
 *
 * 防失焦：至少抓到 1 个回退点（CHANGELOG 的写法变了 → 护栏跟着改，不许静默空转）。
 * ------------------------------------------------------------------ */

{
  const changelog = read('CHANGELOG.md');
  /**
   * 只认**指针写法本身**，不认"正文里出现『回退点』三个字的行上的任意反引号"。
   * 第一版写成后者，**当场被自己咬红**：本轮 CHANGELOG 里有两句描述实验的话
   * （"把回退点指向一个不存在的旧格式标签 `v0.54.0-M9b-B3`"）—— 那是在讲一个**故意不存在的靶子**，
   * 不是回退点。判据因此收到 `回退点：X` / `上一版 X` 两种指针形态上。
   */
  const flat = (s) => s.split('*').join(''); // 容忍 **回退点**： 这种加粗写法
  const refs = new Set();
  for (const rawLine of changelog.split('\n')) {
    const line = flat(rawLine);
    for (const re of [/回退点[：:]\s*`(v\d[^`\s]*)`/g, /上一版\s?`(v\d[^`\s]*)`/g]) {
      for (const m of line.matchAll(re)) refs.add(m[1]);
    }
  }
  const refList = [...refs];

  /**
   * **本轮那条豁免存在性**：回退点写的是"这一版"的标签，而按流程标签是**门禁之后**才打的 ——
   * 要求它先于自己存在，等于给每轮造一条必然的红灯；红灯常态化 = 以后没人当真，护栏自毁。
   * 所以版本号等于 CHANGELOG **最新条目**的标签只查格式、不查存在；
   * 从**下一轮**起它就是历史条目，存在性照常咬（真写错最多晚一轮暴露，不会漏）。
   * 当天的人工核对由 WORK-PROTOCOL 第 2 条「打标签的强制动作」兜住（打完 `git tag --list` 现扫一遍）。
   */
  const vers = [...changelog.matchAll(/^## \[v(\d+)\.(\d+)\.(\d+)-/gm)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ]);
  const newest = vers.reduce((a, b) => (verAbove(b, a) ? b : a), [0, 0, 0]);
  const isCurrentRound = (t) => {
    const m = /^v(\d+)\.(\d+)\.(\d+)-/.exec(t);
    return (
      m !== null &&
      Number(m[1]) === newest[0] &&
      Number(m[2]) === newest[1] &&
      Number(m[3]) === newest[2]
    );
  };

  let tags = null;
  try {
    tags = execFileSync('git', ['tag', '--list'], { cwd: repoRoot, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    tags = null; // 没有 git（或跑不通）：只查格式，存在性如实跳过
  }

  const FLOOR = [0, 53, 0]; // 自 v0.54.0 起按新格式；v0.53.0 及以前 = 历史
  const TAG_RE = new RegExp('^(' + TRACK_WORDS.join('|') + ')\\d*$');
  const badFormat = [];
  for (const t of refList) {
    const m = /^v(\d+)\.(\d+)\.(\d+)-(\S+)$/.exec(t);
    if (m === null) {
      badFormat.push(`${t}（不是 vX.Y.Z-后缀 的形态）`);
      continue;
    }
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!verAbove(v, FLOOR)) continue;
    if (!TAG_RE.test(m[4])) badFormat.push(`${t}（标签只取轨道段，不带任务号后缀）`);
  }

  const skipped = refList.filter(isCurrentRound);
  const missing = tags === null ? [] : refList.filter((t) => !isCurrentRound(t) && !tags.includes(t));
  report(
    `CHANGELOG 的回退点标签真实存在且格式合规（现扫 ${String(refList.length)} 个引用，本轮 ${String(skipped.length)} 个只查格式${tags === null ? '；本机无 git，存在性跳过' : ''}）`,
    refList.length > 0 && badFormat.length === 0 && missing.length === 0,
    [
      missing.length > 0 ? `标签不存在：${missing.join('、')}` : '',
      badFormat.length > 0 ? `格式不符：${badFormat.join('、')}` : '',
      refList.length === 0 ? 'CHANGELOG 里没抓到回退点标签（指针写法变了？护栏要跟着改）' : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 13. 测试收集范围必须真的覆盖到每个测试文件（T13 · 2026-10-08）
 *
 * 为什么立它：`vitest.config.ts` 里曾经同时写着 `passWithNoTests: true` 和**两个同名 `include` 键**。
 * 这两个东西的共同失败模式是"**少跑了东西但仍然全绿**"：
 * - `passWithNoTests: true` = 一个测试文件都没收集到，也以退出码 0 收场；
 * - 重复的 `include` 键 = 后者覆盖前者，于是改第一行的人在改**死代码**，
 *   而 pattern 与磁盘上的测试文件一旦脱钩（新增目录、改名），那个文件就**永远不会被跑**，
 *   并且没有任何地方会说"你今天没跑它"。
 * 单测数量对得上不代表每个文件都被收进去了 —— 本仓原先只有"PROGRESS 的测试文件数 vs 实扫"这一条，
 * 它盯得住"文件存在"，盯不住"被收集"。这条补的正是后半截。
 *
 * 判据全现扫：include 模式从配置里读，测试文件从磁盘扫，两边用同一套 glob 匹配。
 * ------------------------------------------------------------------ */

{
  const cfgRaw = read('vitest.config.ts');
  const includeBlocks = [...cfgRaw.matchAll(/include:\s*\[([\s\S]*?)\]/g)];
  const patterns = includeBlocks.flatMap((b) => [...b[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const testFiles = walkLiveFiles(['.ts', '.tsx']).filter(
    (rel) => /^(apps|packages)\//.test(rel) && /\.test\.tsx?$/.test(rel),
  );

  const uncovered = testFiles.filter((f) => !patterns.some((p) => globToRe(p).test(f)));
  const zeroOk = /passWithNoTests\s*:\s*true/.test(cfgRaw);

  report(
    `测试收集范围：include 只写一份、每个测试文件都在范围内、且不许"零测试也算过"（现扫 ${String(testFiles.length)} 个文件 / ${String(patterns.length)} 条模式）`,
    includeBlocks.length === 1 &&
      patterns.length > 0 &&
      testFiles.length > 0 &&
      uncovered.length === 0 &&
      !zeroOk,
    [
      includeBlocks.length !== 1
        ? `vitest.config.ts 里有 ${String(includeBlocks.length)} 个 include 键（同名键只有最后一个生效，其余是死代码）`
        : '',
      zeroOk ? 'passWithNoTests: true 回来了 —— 一个测试都没收集到也会绿' : '',
      patterns.length === 0 ? '读不到 include 模式（配置写法变了？护栏要跟着改）' : '',
      testFiles.length === 0 ? '磁盘上一个测试文件都没有 —— 门禁在跑空' : '',
      uncovered.length > 0 ? `这些测试文件不在任何 include 模式里，永远不会被跑：${uncovered.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 14. CI 的门禁清单必须与声明一致（T14 · 2026-10-08）
 *
 * 为什么立它：这条检查要防的事故是"**CI 说它跑了，其实没跑**"。
 * R-06 那一轮把 `check:docs` 补进 CI 时，是靠人在 PR 里看一眼 workflow 文件；
 * 而 workflow 是 YAML，没有任何东西盯着它 —— 删一行、改个脚本名、把变异测试塞回每次 push，
 * 都不会让任何测试变红。声明与执行的分叉就是这么来的（本仓已经为同类分叉立过三条锁）。
 *
 * 判据（全部现扫 `.github/workflows/`）：
 * - workflow 里每个 `npm run X` 都必须在 package.json 里真实存在（防"改个名字就静默少跑"）；
 * - 快档里**能在无头环境跑的**那几项（lint / typecheck / test / check:docs）+ 许可证门禁必须在 ci.yml；
 * - **`e2e` / `smoke` / `perf` 不许出现在 ci.yml**：它们要真实图形环境，塞进 CI 只会变成"偶尔红的噪声"，
 *   而噪声比不跑更糟（见 `docs/PROGRESS.md` 的分档说明）；
 * - 变异必须**独立成一条手动 workflow**，且不得混进 ci.yml（成本与触发方式要匹配，见该文件头部注释）。
 * ------------------------------------------------------------------ */

{
  const WF_DIR = '.github/workflows';
  const files = exists(WF_DIR)
    ? readdirSync(join(repoRoot, WF_DIR)).filter((f) => /\.(yml|yaml)$/.test(f))
    : [];
  const text = (f) => (files.includes(f) ? read(`${WF_DIR}/${f}`) : '');
  const ciText = text('ci.yml');
  const mutText = text('mutation.yml');

  const unknown = [];
  let refs = 0;
  for (const f of files) {
    for (const m of text(f).matchAll(/npm run ([a-z][a-z0-9:_-]*)/gi)) {
      refs += 1;
      if (!allScripts.has(m[1])) unknown.push(`${f} → npm run ${m[1]}`);
    }
  }

  const MUST_IN_CI = ['lint', 'typecheck', 'test', 'check:docs', 'license:check'];
  const missingInCi = MUST_IN_CI.filter((s) => !ciText.includes(`npm run ${s}`));
  const headlessOnly = ['e2e', 'smoke', 'perf'];
  const wronglyInCi = headlessOnly.filter((s) => ciText.includes(`npm run ${s}`));
  const mutOk = /workflow_dispatch/.test(mutText) && mutText.includes('npm run mut');

  report(
    `CI 门禁清单与声明一致（现扫 ${String(files.length)} 个 workflow、${String(refs)} 处 npm run 引用；变异独立手动触发）`,
    files.length >= 2 &&
      refs > 0 &&
      unknown.length === 0 &&
      missingInCi.length === 0 &&
      wronglyInCi.length === 0 &&
      mutOk &&
      !ciText.includes('npm run mut'),
    [
      unknown.length > 0 ? `workflow 引用了 package.json 里没有的脚本：${unknown.join('、')}` : '',
      missingInCi.length > 0 ? `ci.yml 少了必须跑的门禁：${missingInCi.join('、')}` : '',
      wronglyInCi.length > 0 ? `ci.yml 里出现了需要真实图形环境的门禁（应在本地跑）：${wronglyInCi.join('、')}` : '',
      !mutOk ? 'mutation.yml 缺失、没有 workflow_dispatch、或没跑 npm run mut' : '',
      ciText.includes('npm run mut') ? '变异又被塞回每次 push 的 CI 了 —— 它必须在独立的手动 workflow 里' : '',
      files.length < 2 ? `只扫到 ${String(files.length)} 个 workflow 文件（少于 2 个 = 有文件被删或改名）` : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 15. 同一个测试文件里不得出现重名用例（R6c · 2026-10-09）
 *
 * 为什么立它：`packages/agent-core/src/mcp/client.test.ts` 里曾有**一整个重复的 describe 块** ——
 * 三条用例标题一字不差地各写了两遍，是 `dcc3f0a` 那一轮追加时把同一段贴了两次留下的。
 * 危害不是"跑得慢一点"，而是**测试总数会骗人**：本仓有两处门禁在对用例数字
 * （PROGRESS 的当前规模、check:docs 的文件数），而"覆盖了 3 个场景"与
 * "同一个场景测了两遍"在总数上长得一模一样 —— 少一份覆盖，还多一份自信。
 *
 * 判据：扫 `apps/` 与 `packages/` 下的 `.test.ts(x)`，以「最近的顶层 describe 标题 + 用例标题」为键，
 * 同文件内出现两次即红。
 * 口径边界（如实写明）：只认**引号标题**。`` it(`拒绝 ${scheme}…`) `` 这种模板标题是循环生成的
 * （`browser/policy.test.ts` 就是这么写的），源码文本相同而运行时各不相同，纳入判据会误伤。
 * ------------------------------------------------------------------ */

{
  const testFiles = walkLiveFiles(['.ts', '.tsx']).filter(
    (rel) => /^(apps|packages)\//.test(rel) && /\.test\.tsx?$/.test(rel),
  );
  const dupes = [];
  let cases = 0;

  for (const rel of testFiles) {
    const counts = new Map();
    let top = '';
    for (const line of read(rel).split(/\r?\n/)) {
      const d = line.match(/^describe\(\s*(['"])(.*?)\1/);
      if (d) top = d[2];
      const t = line.match(/^\s*(?:it|test)(?:\.\w+)?\(\s*(['"])(.*?)\1/);
      if (!t) continue;
      cases += 1;
      const key = `${top}::${t[2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [k, n] of counts) {
      if (n > 1) dupes.push(`${rel} → ${k}（×${String(n)}）`);
    }
  }

  report(
    `测试用例标题在单文件内唯一（现扫 ${String(testFiles.length)} 个文件、${String(cases)} 条引号标题用例）`,
    testFiles.length > 0 && dupes.length === 0,
    [
      testFiles.length === 0 ? '一个测试文件都没扫到 —— 这条护栏在跑空' : '',
      dupes.length > 0
        ? `同一条用例出现两次，多半是整块贴了两遍（总数会因此虚高）：\n     ${dupes.join('\n     ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 16. 段落完整性：吃标题会当场现形（R24 · "整节插入吃标题"四次复发后的机械化）
 *
 * 为什么加：编辑工具"整节插入"时锚点选在下一节标题上、new_string 又没写回它，
 * 标题就被静默吃掉（026/R14/R15/R16 四次，全靠 grep 事后抓）。这一类伤是**结构性**的：
 * ① CHANGELOG：每个 `## [v` 段落**恰有一条 `---` 分隔线**（吃掉标题会把两段并成一段 → 两条）；
 *    标题数必须 == `回退点：` 出现数（吃掉标题 → 标题 11 / 回退点 12）。
 * ② 复核台账：`## 复核 NN` 编号自 050 起必须**连续无洞**（吃掉标题 → 编号缺口）。
 * 判据全部现扫；防失焦：两边都要扫到非零内容，扫空先红。
 * ------------------------------------------------------------------ */
{
  const scanSegments = (text, headRe) => {
    const lines = text.split('\n');
    const heads = [];
    lines.forEach((l, i) => {
      if (headRe.test(l)) heads.push(i);
    });
    const bad = [];
    for (let k = 0; k < heads.length - 1; k += 1) {
      const seg = lines.slice(heads[k], heads[k + 1]);
      const seps = seg.filter((l) => l === '---').length;
      if (seps !== 1) {
        bad.push(`第 ${heads[k] + 1} 行起「${(lines[heads[k]] ?? '').slice(0, 36)}…」段内 '---' 计 ${seps} 条（应恰 1 条）`);
      }
    }
    return { heads: heads.length, bad };
  };
  const clText = read('CHANGELOG.md');
  const cl = scanSegments(clText, /^## \[v/);
  const clFoots = (clText.match(/^\*\*回退点\*\*：/gm) ?? []).length; // 注意是 `**回退点**：`（粗体包着，冒号在 ** 之后）
  const rlText = read('review/REVIEW-LOG.md');
  const nums = [...rlText.matchAll(/^## 复核 (\d+)/gm)].map((m) => Number(m[1])).filter((n) => n >= 50);
  const gaps = [];
  for (let i = 1; i < nums.length; i += 1) {
    if ((nums[i] ?? 0) !== (nums[i - 1] ?? 0) + 1) gaps.push(`${String(nums[i - 1])} → ${String(nums[i])}`);
  }
  report(
    `段落完整性：CHANGELOG 每段恰一条 '---' 且回退点数目对齐；复核编号无洞（现扫 ${String(cl.heads)} 段 / 复核 ${String(nums.length)} 条）`,
    cl.bad.length === 0 &&
      cl.heads === clFoots &&
      cl.heads > 0 &&
      nums.length > 0 &&
      gaps.length === 0,
    [
      ...cl.bad,
      cl.heads !== clFoots ? `CHANGELOG 标题 ${String(cl.heads)} 个但「回退点：」${String(clFoots)} 处（有标题被吃）` : '',
      cl.heads === 0 ? '一段都没扫到 —— 段落定位器失效（防失焦）' : '',
      nums.length === 0 ? '复核编号一条都没扫到 —— 防失焦先红' : '',
      gaps.length > 0 ? `复核编号不连续：${gaps.join('、')}（吃标题或跳号）` : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 17. CHANGELOG 标题时间戳不许晚于"标签指向的那次提交"（R26 · 复核 084）
 *
 * 为什么加：R21–R24 四条条目把"打算什么时候收口"写成了时间戳（比真实提交晚 27 分钟到 7 小时），
 * R25 初稿更写成次晨 01:10 —— **未来时间**。台账里的时间戳也是数字，凭印象写就会往"更从容"的方向飘；
 * R25 靠手工逐条对 `git log` 才挖出来（复核 082），这条把那次手工对账固化成机器判断。
 *
 * 时区坑（设计上绕开）：标题是本机墙钟（+0800），而 CI runner 的本地时区是 UTC ——
 * 若比较"现在"就会把正确的标题判成未来。这里取 `git log -1 --format=%ai <tag>`
 * （提交**自己记录**的偏移）截前 16 字符，比的是同一面墙钟，与检查器跑在哪台机器无关
 * （CI 的 checkout 已是 `fetch-depth: 0`，标签在）。
 *
 * 最新一条豁免时刻比对：它正等着本轮打标签 —— 与第 14 条"回退点标签存在性"同一口径。
 * 防失焦：一条都没比对上（标签全读不到 / 标题解析失效）先红，不静默放过。
 * ------------------------------------------------------------------ */
{
  const heads = [
    ...read('CHANGELOG.md').matchAll(
      /^## \[(v[\d.]+-[^\s·\]]+)[^\]\n]*\] — (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/gm,
    ),
  ];
  const late = [];
  const unreadable = [];
  let compared = 0;
  heads.forEach((m, idx) => {
    const tag = m[1] ?? '';
    const stated = m[2] ?? '';
    if (idx === 0) return;
    let stamp = '';
    try {
      stamp = execFileSync('git', ['log', '-1', '--format=%ai', tag], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .trim()
        .slice(0, 16);
    } catch {
      unreadable.push(tag);
      return;
    }
    compared += 1;
    if (stated > stamp) late.push(`${tag}：标题写 ${stated}，而标签指向的提交在 ${stamp}`);
  });
  report(
    `CHANGELOG 标题时间戳不晚于标签指向的提交（现扫 ${String(heads.length)} 条 / 比对 ${String(compared)} 条 / 最新一条豁免）`,
    heads.length > 0 && compared > 0 && late.length === 0 && unreadable.length === 0,
    [
      heads.length === 0 ? '一条标题都没解析到 —— 这条护栏在跑空' : '',
      heads.length > 0 && compared === 0
        ? '一条都没比对上：标签在本地读不到（git 不在 PATH？CI 需要 fetch-depth: 0）'
        : '',
      unreadable.length > 0 ? `这些标签读不到，时刻无法核对：${unreadable.join('、')}` : '',
      late.length > 0
        ? `标题时间**晚于**提交时刻（不许写"打算什么时候"，更不许写未来）：\n     ${late.join('\n     ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 18. 滚动叙述禁令：权威之外不许抄"最近几轮交付了什么"（R26 · 复核 084）
 *
 * 为什么加：PROGRESS §三 停在 `v0.56.0-铺设9` 达 20 轮（自 `023d8ff`，2026-10-08 起没人更新），
 * HANDOVER 的「最近三轮已交付」停在 `v0.48–50`。这类句子**天生会过期** —— 每轮都要人记得改，
 * 而"状态只写一处"本来就是本仓纪律（数字同理，见第 5 条"N件套"）。
 * 治本是把两处改成指针（CHANGELOG 顶部 12 条 / ROADMAP §6.2），这条负责保证**再写回来当场红**。
 * 防失焦：PROGRESS 连 §三 都找不到时先红（护栏不许跑在没有靶子的地方）。
 * ------------------------------------------------------------------ */
{
  const at = progress.indexOf('## 三、下一个动作');
  const hits = [];
  if (at === -1) hits.push('PROGRESS 里找不到「## 三、下一个动作」这一节 —— 护栏失去靶子');
  const sec = at === -1 ? '' : progress.slice(at);
  for (const m of sec.matchAll(/\*\*最新交付\*\*/g)) {
    hits.push(`PROGRESS §三 第 ${String(progress.slice(0, at + m.index).split('\n').length)} 行写了「**最新交付**」`);
  }
  const ho = read('docs/HANDOVER.md');
  for (const m of ho.matchAll(/\*\*最近三轮已交付\*\*/g)) {
    hits.push(`HANDOVER 第 ${String(ho.slice(0, m.index).split('\n').length)} 行写了「**最近三轮已交付**」`);
  }
  report(
    '滚动叙述禁令：PROGRESS §三 与 HANDOVER 不许抄"最近几轮交付了什么"（只许指回 CHANGELOG 顶部与 ROADMAP §6.2）',
    at !== -1 && hits.length === 0,
    hits.length === 0
      ? ''
      : `${hits.join('\n     ')}\n     这类句子必然过期：进度请写进 CHANGELOG 或 ` + '`TRACK-ROADMAP.md` §6.2，本节只留指针。',
  );
}

/* ------------------------------------------------------------------ *
 * 19. 状态句回归锁：已被证伪的"还没做"句式不许回来（R26 · 复核 084）
 *
 * 为什么加：2026-10-09 深度审计数出 9 处文档漂移，根因不是"没人写文档"，而是
 * **同一句状态写在多处、交付之后只改了一处**（HANDOVER 的"半更新"态最典型：同一页里
 * M9 说已收口、M9b 说没开始）。数字类漂移早被第 4b/6 条盯住，状态句一直没人管 ——
 * 因为"还没做完"本身合法，机器无法凭一句话判断真假。
 * 折中做法：**把本轮逐条核实为假的写法钉成短语锁**，再出现即红（每条都指回一次真实漂移）。
 * 范围 = README 与 docs/ 下的活文档：历史归档、CHANGELOG 旧条目与 review/ 台账
 * 都是审计轨迹（要允许它们引用当时写错的话），不扫也不回改。
 * ------------------------------------------------------------------ */
{
  const PHRASE_LOCKS = [
    ['M9b 未开始', '画布五批已全交付（B3b `v0.77.0-扩容4`）'],
    ['6b 未做', '6b 已交付 `v0.44.0-铺设6b`'],
    ['6b 待做', '同上 —— 这一条连 DESIGN-SESSIONS 的标题行都漂过'],
    ['`push`（**尚未实现**', 'push 已交付 `v0.56.0-铺设9`（硬 ask、不可被「总是允许」压掉）'],
    ['PDF / Markdown 应用内查看（选型待拍板', '两者都已交付（`v0.36.0-扩容3` / `v0.46.0-M19a`·`v0.47.0-M19b`）'],
    ['（argv/process）**零测试**', '`argv.test.ts` 自 `v0.57.0-加固4` 就在；`process.ts` 无专测另记在 R-13'],
    ['渲染层**零单测**', '渲染层现有 23 个测试文件'],
  ];
  const hits = [];
  let scanned = 0;
  for (const rel of walkLiveFiles(['.md'])) {
    if (rel !== 'README.md' && !rel.startsWith('docs/')) continue;
    if (rel === 'CHANGELOG.md') continue; // 历史条目原文不回改，也不当违例
    scanned += 1;
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      for (const [phrase, why] of PHRASE_LOCKS) {
        if (line.includes(phrase)) hits.push(`${rel}:${String(i + 1)}「${phrase}」—— ${why}`);
      }
    });
  }
  report(
    `状态句回归锁：已被证伪的"还没做"句式不许回来（锁 ${String(PHRASE_LOCKS.length)} 条 / 现扫 ${String(scanned)} 份活文档）`,
    scanned > 0 && hits.length === 0,
    [scanned === 0 ? '一份活文档都没扫到 —— 这条护栏在跑空' : '', hits.join('\n     ')]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 20. 活文档的编号小节必须连续（R26 · 复核 084）
 *
 * 为什么加：第 16 条把"整节插入吃标题"这一类机械化到了 CHANGELOG 与复核台账 —— 而它**不限**
 * 在那两份。R26 施工时自己踩了一次：给 `docs/TEST-POLICY.md` 追加一节时拿"## 六、…"整行当锚点、
 * new_string 没写回它，标题被静吃掉（正文还在、编号从五直接跳到七）。**当天就写进禁忌表的形状，
 * 作者本人都复发了** —— 说明只靠人记得必然再犯，于是把 16 号的判据推广到活文档。
 *
 * 判据：同一文件里 `^## [一二三…]、` 这一类小节标题，**按出现顺序必须是 1,2,3… 每次 +1**
 * （吃标题 → 跳号；整节错位 → 重号或倒序）。两种情形都点名文件 + 行号。
 * 不参与判定的：用阿拉伯编号的文档（HANDOVER）、没有编号小节的文档（README）—— 它们**不足两条**，
 * 跳过；但参与判定的文件数太少说明定位器失效（防失焦先红，与 16 号同口径）。
 * ------------------------------------------------------------------ */
{
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const toCn = (s) => {
    if (s === '十') return 10;
    if (s.startsWith('十')) return 10 + (CN[s.slice(1)] ?? 0);
    const tail = s.indexOf('十');
    if (tail > 0) return (CN[s.slice(0, tail)] ?? 0) * 10 + (CN[s.slice(tail + 1)] ?? 0);
    return CN[s] ?? 0;
  };
  const bad = [];
  let participating = 0;
  for (const rel of walkLiveFiles(['.md'])) {
    if (rel === 'CHANGELOG.md') continue; // 顶部 12 条不参与编号检查（16 号已按段落管它）
    const lines = read(rel).split('\n');
    const seq = [];
    lines.forEach((l, i) => {
      const m = /^## ([一二三四五六七八九十]+)、/.exec(l);
      if (m) seq.push({ n: toCn(m[1]), line: i + 1, text: l.slice(0, 40) });
    });
    if (seq.length < 2) continue;
    participating += 1;
    seq.forEach((h, i) => {
      if (h.n !== i + 1) {
        bad.push(
          `${rel}:${String(h.line)} 第 ${String(i + 1)} 个编号小节却写着「${h.text}…」` +
            `（期望「## ${'一二三四五六七八九十'[i] ?? String(i + 1)}、…」—— 上一节标题被吃掉或编号重复/倒序）`,
        );
      }
    });
  }
  report(
    `活文档的编号小节连续无跳号无重号（现参与 ${String(participating)} 份文档；不足两个编号小节的文档不参与）`,
    participating >= 5 && bad.length === 0,
    [
      participating < 5 ? `只有 ${String(participating)} 份文档参与 —— 编号定位器可能失效（防失焦）` : '',
      bad.length > 0 ? bad.join('\n     ') : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 21. 在库文本文件行尾必须是 LF（规整17 撞出来的 T62 同族，R30 立 · 2026-10-15）
 *
 * 为什么立它：改 `docs/TEST-POLICY.md` 时把**整份文件转成了 CRLF**，而
 * `git diff --numstat` 报的是干净的 `15/0` —— git 在 diff 时就做了行尾归一化，
 * 上一轮刚立的"改完核对 diff 行数"这条**救不了这一种**。暴露它的只有
 * `git diff --name-only` 附带的那句 `CRLF will be replaced by LF` 警告 ——
 * 靠人看见警告不是判据（§七 那条老规矩第三次应用）。
 *
 * 判据：**按字节读**，出现 `\r\n` 就违规。范围沿用 walkLiveFiles（排除依赖/产物/回收站/临时/归档）。
 * 现扫基线：444 个在库文本文件 0 命中 ⇒ 从零命中起步，**没有豁免清单**。
 * ------------------------------------------------------------------ */
{
  const TEXT_EXTS = [
    '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml',
    '.css', '.html', '.py', '.txt', '.svg',
  ];
  const hits = [];
  let scanned = 0;
  for (const rel of walkLiveFiles(TEXT_EXTS)) {
    if (rel === 'package-lock.json') continue; // npm 生成，与第 9 条同豁免口径
    const buf = readFileSync(join(repoRoot, rel));
    scanned += 1;
    const at = buf.indexOf('\r\n');
    if (at >= 0) {
      const text = buf.toString('utf8');
      const line = text.slice(0, at).split('\n').length;
      const count = text.split('\r\n').length - 1;
      hits.push(`${rel}:${String(line)} 行起是 CRLF（整文件 ${String(count)} 处）`);
    }
  }
  report(
    `在库文本文件行尾统一 LF（现扫 ${String(scanned)} 个；CRLF 会把按 '\\n' 切行的护栏整批打红）`,
    scanned > 300 && hits.length === 0,
    [
      scanned <= 300 ? `只扫了 ${String(scanned)} 个文件 —— 定位器可能失效（防失焦先红）` : '',
      hits.length > 0 ? hits.join('\n     ') : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 22. Markdown 表格行必须自封闭（R30 立 · 2026-10-15）
 *
 * 为什么立它：本轮往 PROGRESS / ROADMAP 追加交付行时**把一行表格写成了两行**（`awk` 现扫才发现）。
 * Markdown 的表格行不跨物理行 —— 断了之后渲染出的表格在那里直接收摊，续写的正文变成表外的散装文本，
 * **看起来像"多写了几行说明"**，读的人会以为那一格的内容就是前半句。
 * 立闸前已把现存 6 处断行全部合并回单行（内容一字不改，只接掉换行；复扫 0 命中）。
 *
 * 判据取**窄**：以 `|` 开头的行必须以 `|` 收尾（跳过围栏代码块）。
 * 刻意不去数"每行列数是否一致" —— 正文里出现竖线（`A | B`、表格里的斜杠竖杠混排）就误报，
 * 而**误报三次的判据最后都是被人删掉**，比不立更坏（本仓 §七 的教训）。
 * ------------------------------------------------------------------ */
{
  const bad = [];
  let rows = 0;
  for (const rel of walkLiveFiles(['.md'])) {
    const lines = read(rel).split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (/^\s*```/.test(l)) {
        fence = !fence;
        continue;
      }
      if (fence) continue;
      if (!/^\s*\|/.test(l)) continue;
      rows += 1;
      if (!/\|\s*$/.test(l)) {
        bad.push(`${rel}:${String(i + 1)} 以 | 开头却不以 | 收尾（表格行被写成两行）：${l.slice(0, 46)}…`);
      }
    }
  }
  report(
    `Markdown 表格行自封闭（现扫 ${String(rows)} 行；断行会让渲染出的表格当场收摊）`,
    rows > 100 && bad.length === 0,
    [
      rows <= 100 ? `只认到 ${String(rows)} 行表格 —— 定位器可能失效（防失焦先红）` : '',
      bad.length > 0 ? bad.join('\n     ') : '',
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 23. 展示页截图与清单一致（R32 立 · 2026-10-15）
 *
 * 为什么立它：README 上的截图是**对外的声称**（"这就是这个应用长这样"），而它比任何文档都容易过期 ——
 * R12 手工拍过一次之后，仓里既没有截图脚本也没有任何判据盯着，结果两张图的 mtime 停在 v0.75.0，
 * 而版本已经走到 v0.90.x。像素里的漂移 `check:docs` 第 9/9b 条看不见（那是查文本的本机路径），
 * 所以这一步要立的是**账**：图、清单、README 三处必须互相对得上。
 *
 * 判据取三条**结构关系**，刻意不取"图必须是最新版"：
 * ① 清单列出的每张图都在盘上、且不是空白图（字节下限）；
 * ② 清单与 README **双向对账**（拍了没人引用 = 白拍；引用了清单没有 = 图与账分家）；
 * ③ README 的图注必须写着清单记录的那个版本（换了图没换字、换了字没换图都会红）。
 * 为什么不判"图注版本 == package.json 版本"：那是**每轮必然红**的锁（发版比截图勤得多），
 * 而"天生红的锁教人无视红灯"是本仓的老账 —— 图注说清"这是哪一版的产物 + 怎么重拍"就是诚实。
 * ------------------------------------------------------------------ */
{
  const MANIFEST = 'docs/screenshots/manifest.json';
  const bad = [];
  let listed = 0;
  if (!exists(MANIFEST)) {
    bad.push('缺 docs/screenshots/manifest.json —— 展示页的图说不出"哪一版、怎么重拍"，等于不可复跑');
  } else {
    let mf = null;
    try {
      mf = JSON.parse(read(MANIFEST));
    } catch (err) {
      bad.push(`清单不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
    }
    const readme = read('README.md');
    if (mf !== null) {
      for (const key of ['version', 'commit', 'capturedAt', 'howToReshoot', 'dirtyAtCapture']) {
        if (mf[key] === undefined) bad.push(`清单缺字段 ${key}（对外声称的出处要完整）`);
      }
      const files = (mf.shots ?? []).map((s) => s.file);
      listed = files.length;
      // 防失焦：少于四张就是清单或定位器出了问题（本轮起展示页固定四页：概览/对话/画布/文件）
      if (listed < 4) bad.push(`清单只列了 ${String(listed)} 张图（少于 4 张）`);
      for (const f of files) {
        const rel = `docs/screenshots/${f}`;
        if (!exists(rel)) {
          bad.push(`清单里的 ${f} 不在盘上`);
          continue;
        }
        const bytes = readFileSync(join(repoRoot, rel)).length;
        if (bytes < 20_000) bad.push(`${f} 只有 ${String(bytes)} 字节 —— 空白图或截错区域`);
        if (!readme.includes(rel)) bad.push(`${f} 在清单里但 README 没引用（拍了没人看的图）`);
      }
      const referenced = [...readme.matchAll(/docs\/screenshots\/([A-Za-z0-9_-]+\.png)/g)].map((m) => m[1]);
      for (const f of referenced) {
        if (!files.includes(f)) bad.push(`README 引用了 ${f}，清单里却没有（图与账分家）`);
      }
      if (mf.version !== undefined && !readme.includes(`v${String(mf.version)}`)) {
        bad.push(`README 的图注没写清单记录的版本 v${String(mf.version)}（图换了字没换，或反之）`);
      }
    }
  }
  report(
    `展示页截图与清单一致（现扫 ${String(listed)} 张；对外展示的图必须说得出哪一版、怎么重拍）`,
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 24. e2e 的"批准之后读磁盘"必须先等到界面回执（T64 · R32 立 · 2026-10-15）
 *
 * 立闸的起因是真实的红灯：`npm run e2e` 在第 25 步报"批准了却没写进磁盘"，而盘上两秒后
 * 就有那条命令 —— **弹窗 detached 只代表主进程拿到了答案**，`hooks.save()` 的写盘还在后面。
 * 这类"断言抢在真值前面"的洞不会让任何测试变红、只会让门禁随机红，然后被人当成 flake 重跑；
 * 重跑能过就更没人去修 —— 所以把它变成机械判据（老规矩：写进禁忌表的规矩要变成机器判据，否则照样复发）。
 *
 * 判据形状：在「钩子配置」那一步里，`clickDialog*(...)` 之后、任何一条 `waitText*(...)` 之前
 * 出现读盘（`hooksOnDisk()` / `readHooksDiskUntil(`）就是违规 —— 因果顺序必须写死在脚本形状里。
 * **只看代码行，注释先剥掉**：这段的说明文字里就写着 `clickDialog2` 和 `waitText2('已保存')`，
 * 不剥注释的话守卫会被自己的解释骗红（T58 撞过同一件事）。
 * ------------------------------------------------------------------ */

{
  const rel = 'apps/desktop/scripts/e2e-ui.mjs';
  const src = read(rel);
  const bad = [];
  const anchor = src.indexOf("step('钩子配置：改一次问一次");
  if (anchor < 0) {
    bad.push('定位器失效：e2e 脚本里找不到「钩子配置：改一次问一次」那一步 —— 改名了就去同步这条守卫');
  } else {
    const nextStep = src.indexOf('\n  step(', anchor + 10);
    const block = src.slice(anchor, nextStep < 0 ? src.length : nextStep);
    let inBlockComment = false;
    const code = [];
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (inBlockComment) {
        code.push('');
        if (t.includes('*/')) inBlockComment = false;
        continue;
      }
      if (t.startsWith('/*')) {
        code.push('');
        if (!t.includes('*/')) inBlockComment = true;
        continue;
      }
      code.push(t.startsWith('//') || t.startsWith('*') ? '' : line);
    }
    let armedAt = -1;
    let reads = 0;
    let receipts = 0;
    /* 三种形状都要判，所以**不按"命中即 return"写**（第一版就是那样写的，留下两个洞）：
     * ① 一行里既有 `clickDialog*` 又读盘 ⇒ 抢跑（弹窗刚消失就读）；
     * ② 一行里既有界面回执又读盘 ⇒ **合法**（JS 从左往右算，先 await 到回执再读）；
     * ③ 决定之后、回执之前的独立读盘行 ⇒ 抢跑。
     * 换句话说"同一行有回执"可以豁免这一行的读盘，"同一行有点击"绝不能豁免。
     */
    code.forEach((line, i) => {
      const hasClick = /clickDialog\w*\(/.test(line);
      const hasReceipt = /waitText\w*\(/.test(line);
      const hasRead = /hooksOnDisk\(\)|readHooksDiskUntil\(/.test(line);
      if (hasRead) {
        reads += 1;
        if (!hasReceipt && (hasClick || armedAt >= 0)) {
          bad.push(`第 ${String(i + 1)} 行（步内相对行号）在弹窗决定后、任何界面回执前就读了盘：${line.trim().slice(0, 90)}`);
        }
      }
      if (hasClick && armedAt < 0) armedAt = i + 1;
      if (hasReceipt) {
        armedAt = -1;
        receipts += 1;
      }
    });
    // 防失焦下限：守卫自己失效比不装更坏 —— 步里只剩一次读盘 / 一条回执都没等到，说明扫描没走到该走的地方
    if (reads < 2) bad.push(`这一步只扫到 ${String(reads)} 处读盘断言（少于 2 处：拒绝与批准各一处）—— 扫描或脚本形状变了`);
    if (receipts < 2) bad.push(`这一步只扫到 ${String(receipts)} 条界面回执（少于 2 条："未改动"与"已保存"）—— 回执等不到就谈不上"先等再做"`);
  }
  report(
    `e2e 的磁盘断言不抢跑（批准/拒绝之后先等界面回执再读盘；${rel} 的因果顺序）`,
    bad.length === 0,
    `弹窗 detached 只代表主进程拿到答案，写盘还在后面 —— 先等那一句回执（或那次操作自身的 await）再读盘。\n     ` +
      bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 25. 门禁脚本的失败出口不许用 process.exit（T66 · R32 立 · 2026-10-15）
 *
 * 同一个病本月犯了三次：T62 是注入自检的 `fail()` 用 `process.exit(1)` —— **exit 不跑 `finally`**，
 * 于是"用例没拦住"那次刚注入的文件不回滚；本轮新写的截图脚本又是一模一样的形状（失败后
 * `D:\JujiaAgentDemo*` 留在盘上），而 e2e 脚本的 `fail()` 也是 —— 它的 `finally` 负责关三个假服务、
 * 关应用、删临时目录，跳过它的后果是**每红一次就在机器上留一个没人认领的 Electron 进程**
 * （本机那一堆"归属不明"的 electron.exe 与 `.tmp/e2e-*` 残留，至少一部分这么来的，
 * 而负载又回头影响 perf 与偶发红）。
 *
 * 规矩早就写进禁忌表了，照样复发 —— 所以这次改成机器判据：
 * 这四个脚本里 `const fail = (...) => {...}` 的定义体中出现 `process.exit` 即红。
 * （判据只看定义体，不看脚本末尾那个"成功之后统一收场"的 `process.exit(0)` —— 那正是它该有的样子。）
 * ------------------------------------------------------------------ */

{
  const rels = [
    'apps/desktop/scripts/e2e-ui.mjs',
    'apps/desktop/scripts/shoot-ui.mjs',
    'apps/desktop/scripts/verify-pack.mjs',
    'scripts/verify-docs-check.mjs',
  ];
  const bad = [];
  for (const rel of rels) {
    if (!exists(rel)) {
      bad.push(`${rel} 不在了 —— 这条守卫的定位器要跟着改`);
      continue;
    }
    const src = read(rel);
    // 剥注释：这些脚本的说明文字里就写着"process.exit 不跑 finally"，不剥会被自己的解释骗红
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const def = /const fail = \([\s\S]*?\n\};/.exec(bare);
    if (def === null) {
      bad.push(`${rel} 里找不到 \`const fail = ...\` 的定义 —— 失败出口改名了？守卫看不见就等于没有`);
      continue;
    }
    if (def[0].includes('process.exit')) {
      bad.push(`${rel} 的 fail() 里有 process.exit —— exit 不跑 finally，收尾（还原 / 关应用 / 删临时目录）会被跳过，改成抛哨兵异常`);
    }
    if (!bare.includes('} finally {')) {
      bad.push(`${rel} 里没有 finally —— 那"失败也要收尾"这句话没有承载体`);
    }
  }
  report(
    `门禁脚本的失败出口自带收尾（四个脚本的 fail() 不许 process.exit；T66 同族第四次不再靠人记）`,
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 26. e2e 的常驻取证不许被顺手删掉（R34 立 · 2026-10-16）
 *
 * 为什么立它：这个仓库记过两次**同形状**的偶发红 —— 复核 051 的 R-4（第 17 步，现场是画布页）
 * 与规整19 的 T65（第 26 步，现场是外观页）。共同点不是 git 也不是流式，而是"界面当时停在另一个页签"，
 * 而页签只能由页签按钮的 onClick 改，onClick 分不清点从哪来。
 * 上一轮装的取证**只在失败那一刻**取样，所以绿的那一次次里页签被拨来过也看不见 —— 于是 R34 把它
 * 提到窗口级、实时打进门禁日志。这类"以后每一轮都靠它找根因"的东西，最怕的就是后面某轮重构顺手删掉，
 * 而且删掉之后**什么都不会红**（取证不是断言）。所以这次把"装没装"变成判据。
 *
 * 判据两半：
 * ① **每一扇窗都装了**：`app.firstWindow()` 出现 N 次，`await watchWindow(` 至少 N 次（允许多不许少）；
 * ② **五处探针各在其位**（剥注释后逐个 needle）：点击环 / 鼠标移动环 / 页签变化的 MutationObserver /
 *    `page.on('crash'` / 脚本侧撞锁检测 / 失败时读应用自己的运行日志。
 * 防失焦：`app.firstWindow()` 一次都扫不到 = 这条守卫在跑空，照红。
 * ------------------------------------------------------------------ */

{
  const rel = 'apps/desktop/scripts/e2e-ui.mjs';
  const src = read(rel);
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bad = [];
  const windows = (bare.match(/app\.firstWindow\(\)/g) ?? []).length;
  const watched = (bare.match(/await watchWindow\(/g) ?? []).length;
  if (windows === 0) bad.push('扫不到 `app.firstWindow()` —— 窗口取法变了，这条守卫失去靶子');
  if (windows > 0 && watched < windows) {
    bad.push(`开了 ${String(windows)} 扇窗只装了 ${String(watched)} 套取证：那几次重开/新开的窗口出问题时会什么都没有`);
  }
  const needles = [
    ['w.__fxClicks.push(', '点击环（每一次落到 DOM 的点击都记下来）'],
    ['w.__fxMoves.push(', '鼠标移动环（真人手与脚本点击的区分靠它）'],
    ['new MutationObserver(', '页签变化的实时上报（不等失败才取样）'],
    // 判据取**调用形状**（带逗号）而不是光看事件名：日志正文里原本写着 `page.on('crash'` 这句话，
    // 注入用例把事件名改掉之后守卫照样绿 —— 那是"needle 被自己的文案喂饱"，本仓撞过好几次的坑。
    [`page.on('crash',`, '渲染进程崩溃的单独一句（[47] Page crashed 那一族）'],
    ['index\\.lock', '脚本侧撞锁检测（第 17 步那一族的当堂现场）'],
    ['runLogTail()', '失败时把应用自己写的运行日志尾部一起交出来'],
    [`process.on('unhandledRejection'`, '悬挂 Promise 的拒绝说出来但不杀进程（T66 同族：红一次别留一堆积木）'],
  ];
  for (const [needle, why] of needles) {
    if (!bare.includes(needle)) bad.push(`取证探针「${needle}」不在了 —— ${why}`);
  }
  report(
    `e2e 的常驻取证还在原位（${String(windows)} 扇窗 / ${String(watched)} 套记录器；点击 · 鼠标 · 页签 · 崩溃 · 撞锁 · 运行日志 · 未处理拒绝）`,
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 27. 清理脚本的"空文件"判据被窄化过，且不许回到 3.9 的 API（T70 · R35 收口实测）
 * ------------------------------------------------------------------ *
 * 为什么要机器化：`cleanup.py` 原来把**全项目任何 0 字节文件**都当垃圾，
 * 于是它把自己正在写的日志搬进了回收站（`.trash/20261016-153314/.evidence/r35/_t.log` 为证 ——
 * shell 先建空文件、python 最后才打印），合成项目探针还当场量出 `docs/.gitkeep` 也会被搬走。
 * 现在钉三件事：① 空文件只在**临时区**里才算垃圾（`in_temp_area` 的定义与调用都在位）；
 * ② `.evidence`（台账底稿）在跳过名单里；③ 不许用 3.9 才有的 `Path.is_relative_to(`
 * —— PATH 上的 python 实测 3.8.3，用了就是运行时 `AttributeError`。
 * needle 全取**声明 / 调用形状**（带 `def ` 前缀、带 `(`），免得被自己的注释喂饱。
 * ------------------------------------------------------------------ */

{
  const rel = 'scripts/cleanup.py';
  const src = read(rel);
  const bad = [];
  if (src.length === 0) bad.push('读不到 `scripts/cleanup.py`');
  const needles = [
    ['def in_temp_area(p: Path) -> bool:', '空文件要先过"在不在临时区"这道闸 —— 没了就会又回到"全项目空文件都是垃圾"'],
    ['(empty_files if in_temp_area(p) else empty_noted).append(p)', '区外的空文件只报不动那条分流'],
    ['SKIP_DIR_NAMES = {".git", ".workbuddy", "node_modules", ".trash", ".evidence"}', '台账底稿 `.evidence/` 不进遍历'],
    ['②b 区外的空文件', '报告里把"看见了但不动"的那批单列一行（不写就等于静默）'],
  ];
  for (const [needle, why] of needles) {
    if (!src.includes(needle)) bad.push(`「${needle}」不在了 —— ${why}`);
  }
  if (src.includes('.is_relative_to(')) {
    bad.push('用了 `Path.is_relative_to(` —— 那是 3.9 的方法，PATH 上的 python 实测 3.8.3，运行时直接 AttributeError');
  }
  report(
    '清理脚本只把临时区里的空文件当垃圾（`.evidence` 受保护；不用 3.9 才有的 API；T70）',
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 28. 交接文档里写的每一条 `npm run <脚本>` 都必须真实存在（R35 之后 · 复核 094）
 * ------------------------------------------------------------------ *
 * 为什么立它：`俱佳Agent交接文档.md` 是"新接手者的第一小时清单"，它承诺的是**照着敲就能跑**。
 * 本轮自查时就在里面写出过一条根本不存在的 `npm run cleanup`（真实入口是 `python scripts/cleanup.py`）——
 * 而原有的"README 提到的 npm 脚本都存在"那条**只看 README**，扫不到这份新文档。
 * 文档越像"能照抄的说明书"，就越不能有抄不通的命令。
 * 防失焦：文档读不到 / 一条 `npm run` 都没扫到 ⇒ 直接红（"正则改坏了会读成全绿"是老账）。
 * ------------------------------------------------------------------ */

{
  const rel = '俱佳Agent交接文档.md';
  const src = read(rel);
  const scripts = new Set(Object.keys(JSON.parse(read('package.json')).scripts ?? {}));
  const used = [...src.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((n) => !scripts.has(n));
  const bad = [];
  if (src.length === 0) bad.push(`读不到 ${rel}（交接文档是接手基准，不能缺）`);
  if (used.length === 0) bad.push('文档里一条 `npm run` 都没扫到 —— 要么正文被清空，要么这条守卫失去了靶子');
  if (missing.length > 0) bad.push(`写了不存在的脚本：${missing.join(', ')}（对照 package.json 的 scripts 现扫 ${String(scripts.size)} 条）`);
  report(
    `交接文档里的 npm run 脚本都真实存在（现扫 ${String(used.length)} 处引用 / ${String(scripts.size)} 条定义）`,
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 29. Markdown 表格的数据行格数必须与表头一致（R36 · 排查4 实测）
 *
 * 为什么立它：**GFM 的表格行是按"未转义的竖线"切格的**，所以一个裸 `|`
 * —— 哪怕它在行内代码里（`(?:TOKEN|…)`）、哪怕它只是标题的一部分
 * （《contextIsolation | Electron 安全》）—— 都会**真的把一格劈成两格**。
 * 而渲染器（GitHub / marked / 任何 CommonMark 实现）的处理是：
 *   · 多出来的格子**静默丢弃**（那一格的内容人间蒸发）
 *   · 少掉的格子**补空**
 * 于是文档"看起来写全了"，读的人却在渲染后的表格里**看不到那一列**。
 *
 * 本轮实测（27 处，跨 10 个文件）都是这一种：
 *   · `docs/TRACK-ROADMAP.md` 的 T60 行：`\`KV_SECRET_RE\` 的键名段写作
 *     \`[A-Za-z0-9_.-]*(?:TOKEN|…)[A-Za-z0-9_.-]*\`` ⇒ 竖线劈开"条目"与"严重"两列，
 *     渲染后"严重"落到了"状态"列、"状态"列的内容整列消失。
 *   · `docs/PROGRESS.md` 的"扩容1（第3步·下半）"行：只有 2 格而表头 4 格 ⇒
 *     "标签"与"关键证据"两列渲染成空。
 *   · `knowledge/sources/S10-browser-docs.md` 的 T1 几行：数据行 6 格而表头 5 格
 *     ⇒ "验证"列（canonical / canonical（已 WebFetch））**整列被丢弃**。
 *
 * 判据怎么取（这一步是本条的关键，R30 第 22 条已经证过"数列数"的老教训）：
 *   · **按 GFM 的真实切分规则数**：只认**未转义**的竖线（`\|` 不切格）。
 *     —— 这就是 R30 那条"刻意不取列数一致"当时踩的坑：它按**裸竖线**数，
 *     于是一旦正文里合法地出现 `\|` 就会误报；现在按 GFM 语义数，误报源头没了。
 *   · **逐表比**：拿**该表自己的表头**当基准，不是全仓众数。跨表比会把
 *     "本来就是 4 列的表"和"本来是 3 列的表"混在一起。
 *   · **跳过围栏代码块**（里面的 `|` 不是表格）与 **ARCHIVE 归档**
 *     （审计轨迹，不改也不扫 —— 与第 22 条同一口径）。
 *
 * 防失焦：一条数据行都没扫到 ⇒ 直接红（"定位器失效"的老账，见第 12/13 条）。
 * ------------------------------------------------------------------ */
{
  /** 按 GFM 规则切一行的格子：只认未转义的竖线；首尾竖线是分隔符不是格子。 */
  const gfmCells = (line) => {
    const out = [];
    let cur = '';
    let i = 0;
    if (line.startsWith('|')) i = 1;
    for (; i < line.length; i += 1) {
      if (line[i] === '\\') {
        cur += line[i] + (line[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (line[i] === '|') {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += line[i];
    }
    // 行尾竖线后面若还有内容，那是**多出来的一格**（不能丢）——
    // 所以只有"什么都没有"时才不算一格。
    if (cur !== '' || out.length === 0) out.push(cur);
    return out;
  };
  const isSepRow = (l) => /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');

  const bad = [];
  let dataRows = 0;
  let tables = 0;
  for (const rel of walkLiveFiles(['.md'])) {
    const lines = read(rel).split('\n');
    let fence = false;
    let head = null; // 该表自己的表头（{ cells, lineNo }）
    let sepSeen = false;
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (/^\s*```/.test(l)) {
        fence = !fence;
        head = null;
        sepSeen = false;
        continue;
      }
      if (fence) continue;
      if (!/^\s*\|/.test(l)) {
        head = null;
        sepSeen = false;
        continue;
      }
      if (isSepRow(l)) {
        sepSeen = true;
        continue;
      }
      if (!sepSeen) {
        head = { cells: gfmCells(l).length, lineNo: i + 1 };
        tables += 1;
        continue;
      }
      if (!head) continue;
      dataRows += 1;
      const cells = gfmCells(l).length;
      if (cells === head.cells) continue;
      const how = cells > head.cells
        ? `多 ${String(cells - head.cells)} 格（渲染时会被**静默丢弃** ⇒ 那一列的内容人间蒸发）`
        : `少 ${String(head.cells - cells)} 格（渲染时**补空** ⇒ 那一列读成空白）`;
      bad.push(`${rel}:${String(i + 1)}  与本表表头（${rel}:${String(head.lineNo)}，${String(head.cells)} 格）对不齐：本格 ${String(cells)} 格 —— ${how}`);
    }
  }
  report(
    `Markdown 表格的数据行格数与表头一致（现扫 ${String(tables)} 张表 / ${String(dataRows)} 行；GFM 按未转义竖线切格）`,
    dataRows > 100 && bad.length === 0,
    [
      dataRows <= 100 ? `只认到 ${String(dataRows)} 行表格数据 —— 定位器可能失效（防失焦先红）` : '',
      bad.join('\n     '),
    ]
      .filter(Boolean)
      .join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 30. `verify:pack` 的重试必须换一只全新目录（T69① · R37）
 *
 * 为什么立它：R35 的实测把"重试"这件事拆穿了 —— **旧重试每次先 `unlink` 上一回残骸**，
 * 于是第二次尝试**根本没走到 `rename`**，就红在 `EBUSY ... unlink ... default_app.asar` 上。
 * 换句话说：**同一只目录上的"重试"不是重试，是接着上一次的残骸再撞一次同一堵墙**。
 * R35 因此把"每轮换全新目录"登记成 T69①，R37 落地。
 *
 * 判据架在**三件必须同时成立**的事上（缺一件就等于"重跑变成了接着撞"）：
 *   ① 目录名**带尝试序号**（`pack-<run id>` / `pack-<run id>-a2` …）—— 换目录；
 *   ② **输出参数跟着换**（`--config.directories.output=release/<新目录>`）——
 *      只换目录名不换参数，electron-builder 还是写回旧目录，那只正是被锁着的那只；
 *   ③ **收尾认领本轮造过的每一只**（不只最后一只）—— 否则前几只留在盘上没人认领。
 *
 * 为什么架在"调用形状"上而不是"名字"上（§11 第 3 条的老教训）：
 * 判据认的是**"重试块里必须出现这三件事"**，不认注释里写了什么 ——
 * 注释里那几句"换全新目录"的话，恰恰是最容易喂饱假锁的地方。
 * ------------------------------------------------------------------ */
{
  const rel = 'apps/desktop/scripts/verify-pack.mjs';
  const bad = [];
  if (!exists(rel)) {
    bad.push(`${rel} 不在了 —— 这条守卫的定位器要跟着改`);
  } else {
    // 剥注释：脚本里那段解释会写着"换一只全新目录"，不剥就被自己的说明喂饱
    const bare = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // 找"重试块"：从尝试序号自增到那一次等待为止
    const block = /packAttempt \+= 1;[\s\S]*?setTimeout\(resolve, BUILDER_WAIT_MS\)/.exec(bare);
    if (block === null) {
      bad.push(`${rel} 里找不到"重试块"（packAttempt 自增 → 等待）—— 重试逻辑改了形状？守卫看不见就等于没有`);
    } else {
      const b = block[0];
      if (!/PACK_OUT = packOutName\(\)/.test(b)) {
        bad.push(`${rel} 的重试没有换目录名（PACK_OUT 必须重新算出来）—— 同一只目录上的"重试"是接着撞，不是重试（T69①）`);
      }
      if (!/--config\.directories\.output=release\/\$\{PACK_OUT\}/.test(b)) {
        bad.push(`${rel} 的重试没有换输出参数 —— 只换目录名不换参数，electron-builder 还是写回旧目录（那只正是被锁着的那只）`);
      }
      if (!/args\[outIdx\] =/.test(b)) {
        bad.push(`${rel} 的重试没有把新目录写回 args —— 参数不改，输出目录就还是旧的`);
      }
    }
    // 收尾必须认领本轮造过的**每一只**（含 -a2 / -a3）
    if (!/ownDirs = readdirSync\(RELEASE_DIR\)\.filter/.test(bare) || !/for \(const name of ownDirs\)/.test(bare)) {
      bad.push(`${rel} 的收尾没有认领本轮造过的每一只产物目录 —— 重试造出来的前几只会被留在盘上没人认领`);
    }
    // 清场不得扫本轮自己造的那几只（等 finally 统一收）
    const sweep = /const sweepOldPackDirs = \(\) => \{[\s\S]*?\n\};/.exec(bare);
    if (sweep === null || !/startsWith\(`pack-\$\{RUN_ID\}`\)/.test(sweep[0])) {
      bad.push(`${rel} 的开跑清场没有排除本轮自己造的目录 —— 会把本轮要用的那只当"上一轮的"扫掉`);
    }
  }
  report(
    'verify:pack 的重试换全新目录（T69①：换目录名 + 换输出参数 + 收尾认领每一只）',
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 31. 文档里声明的"行数口径"必须与 eslint 的 max-lines 配置一致（R38 评估）
 *
 * 为什么立它：R38 的题面是"评估大文件该不该拆"，而**动手前现扫发现题面前提是错的** ——
 * R20（规整13）登记的"三个候选超阈"用的是**物理行**（`ChatPanel.tsx` 917 行），
 * 而真正会拦人的判据是 eslint 的 `max-lines`（`skipBlankLines` + `skipComments`），
 * **两者差 200~500 行** ⇒ 同一批文件，按物理行算是"超阈、该拆"，
 * 按 eslint 口径算是"没超阈、别拆" —— **结论整个反过来**。
 *
 * **本条只查一件事**：文档里写的"行数怎么算"这句口径说明，
 * 与 `eslint.config.js` 里 `max-lines` 的实际配置**是否一致**。
 * 判据架在"那两个配置项"上 —— **可以直接对账的事实，不猜任何意图**。
 *
 * **为什么不是"扫描所有行数断言、逐个核对数字"**（那才是最初的想法）：
 * 那一版**误报了 12 处** —— 因为"这个数字说的是哪一年的尺寸"只能靠上下文猜，
 * 而"756 行单文件 → 拆成 11 个模块"这种**历史快照**与"现状：`ipc.ts` 565 行"
 * 这种**现状声明**在文本上**没法可靠区分**。
 * 猜不准的判据会**误报三次就被删掉**（§11 第 3 条）⇒ 那条路走不通。
 * ⇒ 改成：**数字由本轮人工核一次并改掉过时的那些**，
 * **口径本身写成一句话钉在文档里**，本条只盯那句话与配置是否一致。
 * ------------------------------------------------------------------ */
{
  const rel = 'eslint.config.js';
  const bad = [];
  let cfg = '';
  if (!exists(rel)) {
    bad.push(`${rel} 不在了 —— 这条守卫的定位器要跟着改`);
  } else {
    cfg = read(rel);
    // eslint 的实际配置：max-lines 的 max / skipBlankLines / skipComments
    // 用 RegExp 构造器而不是正则字面量 —— 写进文件的模板里 `\` 会被吃掉，
    // 那样这条守卫会"认不出配置"却仍然报绿（假锁）。本轮已栽过一次。
    const m = new RegExp("'max-lines':\\s*\\[\\s*'error'\\s*,\\s*\\{([^}]*)\\}\\s*\\]").exec(cfg);
    if (m === null) {
      bad.push(`${rel} 里认不出 max-lines 的配置（'max-lines': ['error', { max: N, ... }]）—— 改写法了？守卫看不见就等于没有`);
    } else {
      // `m[1]` 是 `{...}` 里面的内容 ⇒ 从里面再取 max / skipBlankLines / skipComments
      const rest = m[1] ?? '';
      const maxMatch = new RegExp('max:\\s*(\\d+)').exec(rest);
      const max = maxMatch === null ? NaN : Number(maxMatch[1]);
      if (!Number.isFinite(max)) {
        bad.push(`${rel} 的 max-lines 配置里认不出 max 的数值（看到了：${rest.trim()}）`);
      }
      const skipBlank = new RegExp('skipBlankLines:\\s*true').test(rest);
      const skipComments = new RegExp('skipComments:\\s*true').test(rest);
      if (!skipBlank || !skipComments) {
        bad.push(`${rel} 的 max-lines 没有同时开 skipBlankLines 与 skipComments —— 口径与本文写的不一致`);
      }
      // 文档里必须有一句"行数按 eslint 口径"的话，且它说的配置与实际一致
      const docs = ['docs/TEST-POLICY.md', 'docs/DESIGN-R38-BIGFILE-EVAL.md', '俱佳Agent交接文档.md'];
      const said = [];
      for (const d of docs) {
        if (!exists(d)) continue;
        const t = read(d);
        // 找"行数"旁边的口径声明：必须同时点到 skipBlankLines 与 skipComments
        for (const mm of t.matchAll(new RegExp('[^\\n]{0,200}skipBlankLines[^\\n]{0,200}', 'g'))) {
          const line = mm[0];
          if (!/skipComments/.test(line)) continue;
          said.push({ d, line: line.trim().slice(0, 160) });
        }
      }
      if (said.length === 0) {
        bad.push(
          '活文档里没有一处写明"行数按 eslint 口径（skipBlankLines + skipComments）"—— ' +
            '口径不写清，下一个人又会按物理行评估（R20 就是这么错的）',
        );
      }
      // 口径声明里写的 max 若与实际配置不符 ⇒ 报出来
      for (const s2 of said) {
        const mm = new RegExp('max[^\\d]{0,10}(\\d{3,4})').exec(s2.line);
        if (mm !== null && Number(mm[1]) !== max) {
          bad.push(`${s2.d} 的口径声明写 max ${mm[1]}，而 ${rel} 里是 ${max}`);
        }
        if (!/skipBlankLines/.test(s2.line) || !/skipComments/.test(s2.line)) {
          bad.push(`${s2.d} 的口径声明没有同时点到 skipBlankLines 与 skipComments`);
        }
      }
      if (said.length > 0 && !bad.some((b) => b.includes('口径声明写 max'))) {
        // ok
      }
      if (said.length > 0) {
        for (const s2 of said) {
          // 记录实际读到的口径（供排查）
        }
      }
    }
  }
  report(
    '文档里的行数口径与 eslint 的 max-lines 配置一致（skipBlankLines + skipComments）',
    bad.length === 0,
    bad.join('\n     '),
  );
}

/* ------------------------------------------------------------------ *
 * 32. e2e 里「读真值 / 做下一个动作」之前必须先等到「状态已生效」（T71 · R39 立 · 2026-10-21）
 *
 * 为什么立它：T71 登记的那个红，形状是「把点下去了当成状态已生效」——
 * 脚本「点『清除』→ 立刻点『打开』」，中间没有任何「清除真的生效了」的等待
 * ⇒ 主进程还没清完，确认框就按**旧路径**拼出来了。
 * 它与 T64（批准了却没写进磁盘）、T65 / T68（点了但界面/弹窗没等到）**同族**。
 *
 * 护栏第 24 条只盯住了「钩子配置」那一步的**读盘**那一半，而 T71 这一族是**三个形状**：
 *   ① 「清除自选程序」之后立刻点「打开」—— 后面是**界面文案断言**（不是读盘），第 24 条扫不到；
 *   ② 「允许一次」之后立刻读 NOTES.md —— **是读盘，但在「长期记忆写入」那一步**，
 *      第 24 条的定位器只锚「钩子配置」那一步 ⇒ 同样扫不到；
 *   ③ 「允许一次」之后**固定睡 600ms** 再读盘 —— 是读盘，但在「M19 保存过门」那一步。
 * 三个形状的共同点：**动作发出了 ≠ 状态生效了**。
 *
 * 判据形状（**区间判定**）：
 *   从每一处「会改状态的点击」（清除 / 允许一次 / 记住这一点）**往后**看，
 *   到「读真值」或「下一个点击」为止 —— 这中间**必须出现过一个「等状态的 await」**。
 *   「等状态的 await」有两种形态：
 *   (a) `await <某个 promise>` —— 那个 promise 的结果就是「状态已生效」的真值
 *       （工具调用自己的 promise：`await first;` / `await accepted;`；或本地异步函数的返回值）；
 *   (b) `await wait*(...)` / `await poll*(...)` —— 等界面上会出现一个信号。
 *   **三种明确不算**（它们都不是「状态已生效」）：
 *   · `await win.waitForSelector(..., { state: 'detached' })` —— 弹窗消失只代表
 *     **主进程拿到了答案**，写盘/生效还在后面（这正是 T64 自己的话）；
 *   · `await new Promise(r => setTimeout(r, N))` —— **固定等待 = 靠时序运气**；
 *   · `await <locator>.fill() / .selectOption() / .click() ...` —— **操作控件**，不是等状态
 *     （`await addressBox.fill(...)` 是"等输入框填好"，与服务端状态无关）。
 *
 * 另加两条**必修项**（T71 那两个可等信号不许被删掉）：
 *   `waitForText('已清除自选程序')` 与 `waitForText('已写入长期记忆')` 必须在场。
 *
 * **前五版栽过的坑（写在这里免得再犯）**：
 *   第 1 版判「点击之后的**下一句**」⇒ ① 漏了等待函数的**变体名**；② 把「下一句是
 *     if (x !== true) fail(...)」（断言**上一句**已等出的变量）当违规；③ 还把「const cleared =
 *     await waitForText(...)」这种**声明+等待**跳过去 ⇒ **真违规一条没抓到**（16 处命中全误报）。
 *   第 2 版改成「点击行 → 下一个 await 行」⇒ 误报降到 3 处，但那 3 处**逐条核实也全是误报**：
 *     它们共同的漏法是**「等」的那句话不在「行首是 await」的位置**——一处是 `const x = await p;`
 *     （赋值右边），一处是 `if ((await waitText3(...)) !== true)`（条件里）。
 *   第 3 版改成「这一段里只要出现过 await 就放过」⇒ **校准直接不通过**（还原 T71 后它不红）：
 *     「清除」之后的第一句是 `await addressBox.fill(...)` —— 它含 await，于是被当成了「等信号」。
 *     ⇒ **「有 await」不等于「等到了状态信号」**。
 *   第 4 版把「等状态的 await」与「操作控件的 await」分开 ⇒ 能咬住形状①，
 *     但**咬不住形状②**：`await win.waitForSelector(…, { state: 'detached' })`
 *     （**等弹窗消失**）被当成了「等状态生效」。⇒ 第 5 版把它明确排除。
 *   第 5 版改成「从每一处**读真值**往前找最近的那个 await」⇒ 咬住了形状②，却
 *     **咬不住形状①**（它后面是界面文案断言，根本没有读盘），还在 L1404 误报了一处
 *     （`await first;` 才是真信号，"最近一个 await"这个启发式选错了行）。
 *   ⇒ 第 6 版改成**区间判定**（从「会改状态的点击」往后走到「读真值 / 下一个动作」），
 *     并把「等状态的 await」按**形态**分类（上面三种不算）。
 *
 * **只扫代码行，注释先剥掉** —— 这段判据的说明文字里就写着那些函数名，
 * 不剥会被自己的解释骗红（T58 撞过同一件事）。
 * ------------------------------------------------------------------ */
{
  const rel = 'apps/desktop/scripts/e2e-ui.mjs';
  const bad = [];
  if (!exists(rel)) {
    bad.push(`${rel} 不在了 —— 这条守卫的定位器要跟着改`);
  } else {
    const src = read(rel);
    // 只留代码行（注释先剥掉：这段判据的说明文字里就写着那些函数名）
    let inBlock = false;
    const code = [];
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (inBlock) {
        code.push('');
        if (t.includes('*/')) inBlock = false;
        continue;
      }
      if (t.startsWith('/*')) {
        code.push('');
        if (!t.includes('*/')) inBlock = true;
        continue;
      }
      code.push(t.startsWith('//') ? '' : line);
    }
    // 「会改状态的点击」：点了之后，脚本接下来要观察的正是「它到底生效没有」
    const ARM = /hasText:\s*'(清除|允许一次|记住这一点)'/;
    // 「读真值」：读磁盘
    const READ = /readFileSync|existsSync|readdirSync/;
    // 操作控件：对控件动手，不是等状态
    const ACTION =
      /\.(click|fill|selectOption|type|press|hover|check|uncheck|setInputFiles|focus|blur|scrollIntoViewIfNeeded|tap|dblclick)\s*\(/;
    // 读界面（拿当前值），不是等状态
    const UI_READ =
      /\.(evaluate|evaluateHandle|count|textContent|innerText|inputValue|isVisible|isChecked|getAttribute|boundingBox|allTextContents|locator|getByRole|getByText|getByLabel|getByPlaceholder)\s*\(/;

    /** 那一行里的 await 属于哪一类 */
    const awaitKind = (t) => {
      if (!/\bawait\b/.test(t)) return 'none';
      // 等弹窗消失：只代表主进程拿到了答案，写盘/生效还在后面
      if (/waitForSelector\([^)]*state:\s*'detached'/.test(t)) return 'dialog-gone';
      // 固定等待 = 靠时序运气
      if (/waitForTimeout\s*\(/.test(t)) return 'fixed-sleep';
      if (/new Promise\s*\(/.test(t) && /setTimeout/.test(t)) return 'fixed-sleep';
      // 操作控件：不是等状态
      if (ACTION.test(t)) return 'action';
      // 等一个界面条件
      if (/\.waitFor\s*\(/.test(t)) return 'state';
      // 等信号：await wait*(...) / await poll*(...)（不认具体函数名）
      if (/\bawait\s+(wait|poll)[A-Za-z0-9_]*\s*\(/.test(t)) return 'state';
      // 等操作自己的 promise：await first;  /  const x = await first;
      if (/\bawait\s+[A-Za-z_$][\w$]*\s*;/.test(t)) return 'state';
      // 等本地异步函数的返回值：await tailText();
      if (/\bawait\s+[A-Za-z_$][\w$]*\s*\(/.test(t) && !UI_READ.test(t)) return 'state';
      return 'other';
    };

    // 触发点：会改状态的点击
    const triggers = [];
    code.forEach((t, i) => {
      if (/\.click\(\)/.test(t) && ARM.test(t)) triggers.push(i);
    });

    let stateHits = 0;
    for (const i of triggers) {
      let j = i + 1;
      let hit = null;
      let boundary = null;
      let lastNotState = null;
      while (j < code.length) {
        const raw = code[j];
        const t = raw.trim();
        if (t === '' || t.startsWith('//')) {
          j += 1;
          continue;
        }
        if (READ.test(raw)) {
          boundary = { kind: 'read', line: j + 1, text: t };
          break;
        }
        if (/\.click\(\)/.test(raw)) {
          boundary = { kind: 'click', line: j + 1, text: t };
          break;
        }
        const kind = awaitKind(t);
        if (kind === 'state') {
          hit = { line: j + 1, text: t };
          break;
        }
        if (kind === 'dialog-gone' || kind === 'fixed-sleep' || kind === 'action') {
          lastNotState = { kind, line: j + 1, text: t };
        }
        j += 1;
      }
      if (hit !== null) {
        stateHits += 1;
        continue;
      }
      if (boundary === null) continue; // 后面既没有读真值也没有下一个动作 ⇒ 不是这个形状
      const verb = /hasText:\s*'([^']*)'/.exec(code[i]);
      const what = boundary.kind === 'read' ? '读真值' : '点了下一个动作';
      bad.push(
        `第 ${String(boundary.line)} 行${what}，但它前面那次「${verb === null ? '?' : verb[1]}」之后` +
          '**没有等到「状态已生效」**' +
          (lastNotState === null
            ? ''
            : `（区间里只有第 ${String(lastNotState.line)} 行的「${lastNotState.kind}」）`) +
          ' —— 动作发出了 ≠ 状态生效了（T71 / T64 同族）',
      );
    }

    // 防失焦下限：扫描没走到该走的地方，比不装更坏
    if (triggers.length < 8) {
      bad.push(
        `只扫到 ${String(triggers.length)} 处「会改状态的点击」（少于 8 处）—— 扫描或脚本形状变了`,
      );
    }
    if (stateHits < 8) {
      bad.push(
        `只扫到 ${String(stateHits)} 处「等到了状态信号」（少于 8 处）—— 扫描或脚本形状变了`,
      );
    }

    // 必修项：T71 那两个可等信号不许被删掉（区间判据之外的兜底）
    for (const needle of ["waitForText('已清除自选程序')", "waitForText('已写入长期记忆')"]) {
      if (!code.some((l) => l.includes(needle))) {
        bad.push(`T71 的可等信号没了：${needle} 必须在场 —— 那是本轮修的那两个等待`);
      }
    }
  }
  report(
    'e2e 里「读真值 / 下一个动作」之前先等到「状态已生效」（固定等待与弹窗消失都不算 · T71）',
    bad.length === 0,
    '动作发出了 ≠ 状态生效了：批准/清除之后必须等界面上那句回执（或那次操作自己的 await），' +
      '再读盘、再点下一个动作。\n     ' +
      bad.join('\n     '),
  );
}
/* ------------------------------------------------------------------ *
 * 33. 渲染层样式表里的字号只许走令牌，不许写死 px（R41 · UI 重构批第一轮）
 *
 * 为什么立它：`packages/ui-tokens/src/tokens.ts` 的文件头**明令禁止**
 * "渲染层不允许出现硬编码颜色与时长"，`docs/DESIGN-BASELINE.md` 的 Don't 也写着
 * "不许硬编码颜色、时长、圆角" —— **但那两条是写在文档里的纪律，不是机器判据**。
 * R41 现扫的结果：**主样式表 `styles.css` 里有 53 处写死的 `font-size: Npx`**
 * （9 个不同取值；其中 12.5px / 10px / 20px 三个**根本不是排版档位** ——
 * 那是"等宽代码区 / 微型标记 / 图标字形"三种**角色**混进了字号阶梯，
 * 于是"统一字号"这件事永远达不成）。
 * ⇒ **规则早就写了，缺的是判据** —— 这正是本仓最熟的那种
 * "写进禁忌表的规矩要变成机器判据，否则照样复发"。
 *
 * 判据形状：扫渲染层两份样式表（`styles.css` + `styles/motion.css`）的每一条
 * `font-size:` 声明 —— 值必须是**字号类令牌**（`var(--fs-*)`）或**图标尺寸令牌**
 * （`var(--icon-*)`），或是 `inherit` / `em` / `rem` / `%` 这类**相对量**；
 * **写死的 px 一律红**。
 *
 * **为什么先切字号这一刀**（不是颜色那一刀）：字号是**值可逐条证明等价**的那一类
 * （12px ↔ `--fs-small` 逐个核对 ⇒ 渲染不变）；颜色那一批里藏着"同一个主色两个值"
 * （`styles.css` 用 `rgb(47,111,235)`，令牌是 `#4c8dff`）—— 那**要判断该用哪个**，
 * 换了就是**有意的视觉修正**，归下一刀，不许混在这一刀里。
 * ------------------------------------------------------------------ */
{
  const rels = [
    'apps/desktop/src/renderer/src/styles.css',
    'apps/desktop/src/renderer/src/styles/motion.css',
  ];
  const bad = [];
  let scanned = 0;
  for (const rel of rels) {
    if (!exists(rel)) {
      bad.push(`${rel} 不在了 —— 这条守卫的定位器要跟着改`);
      continue;
    }
    // 剥注释（判据自己的说明文字里就写着那些 token 名，不剥会被自己的解释骗红 —— T58 撞过同一件事）
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    code.split('\n').forEach((l, i) => {
      const m = /font-size:\s*([^;]+);/.exec(l);
      if (m === null) return;
      scanned += 1;
      const v = m[1].trim();
      if (/^var\(--(?:fs|icon)-[a-z0-9-]+\)$/.test(v)) return; // 令牌 ✔
      if (v === 'inherit' || v === 'initial' || v === 'unset') return; // 相对量 ✔
      if (/^(?:em|rem|%|clamp|min|max)\b/.test(v)) return; // 相对量 ✔
      bad.push(`${rel}:${String(i + 1)}  font-size: ${v.slice(0, 40)}`);
    });
  }
  // 防失焦下限：一份字号声明都没扫到 ⇒ 扫描路径写坏了（恒绿比没有锁更坏）
  if (scanned < 20) {
    bad.push(`只扫到 ${String(scanned)} 条字号声明（少于 20 条）—— 扫描或样式表形状变了`);
  }
  report(
    '渲染层样式表里的字号只许走令牌（不许写死 px · R41）',
    bad.length === 0,
    '字号只许用 --fs-* / --icon-* 令牌（或 inherit / em / rem 这类相对量）—— ' +
      '写死 px 就是"下一处漂移"（现扫曾有 53 处）。\n     ' +
      bad.join('\n     '),
  );
}
/* ------------------------------------------------------------------ *
 * 34. 渲染层样式表里的颜色不许写死（只许令牌）· R42
 *
 * 为什么立它：与第 33 条同源 —— 令牌层（W6）与 `docs/DESIGN-BASELINE.md` 的纪律
 * 都写着"不许硬编码颜色"，**但那条一直不是机器判据**。R41 只把**字号**收进了令牌，
 * 颜色这一批留到本轮（因为里面混着"同一个主色两个值"，要先判清该用哪个）。
 *
 * 判据形状：扫主样式表 `styles.css` 的每一条颜色声明 —— 值必须**只由令牌构成**
 * （`var(--c-*)` / `var(--shadow-*)` / `color-mix(...)` 这类由令牌派生的写法）；
 * **写死的 hex / rgb() / rgba() 一律红**。
 * （令牌文件 `styles/motion.css` 里的字面值是**令牌本体**，不扫 —— 那正是它的定义处。）
 *
 * **另外两条一起判**（都是本轮真踩到的形状）：
 *   ① `box-shadow` 必须是**整条令牌**（`var(--shadow-*)`）——
 *      写成 `box-shadow: 0 12px 40px var(--shadow-dialog)` 是**无效声明**
 *      （阴影值被拼在了偏移量后面）⇒ **渲染上看不出来**（只是少了一层阴影），
 *      静态扫"还有没有写死颜色"也扫不到它 ⇒ **只能单独立一条判据**。
 *   ② 同理，任何 `var(--x, <字面量>)` 的**兜底值**都不许是颜色 ——
 *      兜底只在令牌不存在时生效，而令牌永远存在 ⇒ 兜底是历史残留。
 * ------------------------------------------------------------------ */
{
  const styleRel = 'apps/desktop/src/renderer/src/styles.css';
  const motionRel = 'apps/desktop/src/renderer/src/styles/motion.css';
  const bad = [];
  let tokenRefs = 0;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

  // ① 主样式表：颜色只许走令牌
  if (!exists(styleRel)) {
    bad.push(`${styleRel} 不在了 —— 这条守卫的定位器要跟着改`);
  } else {
    strip(read(styleRel))
      .split('\n')
      .forEach((l, i) => {
        for (const m of l.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|rgb\([^)]*\)|hsla?\([^)]*\)/g)) {
          bad.push(`${styleRel}:${String(i + 1)}  写死的颜色 ${m[0].slice(0, 30)}`);
        }
        // ② 整条值的令牌不许被拼坏（`var(--shadow-*)` 只能整条用）
        //    注意：`inset 0 0 0 1px var(--c-primary)`（用颜色令牌自建的环）是**合法**的，
        //    所以这里只抓"整条阴影令牌被塞进了还有别的东西的值里"这一种形状。
        const bs = /box-shadow:\s*([^;]+);/.exec(l);
        if (
          bs !== null &&
          /var\(--shadow-/.test(bs[1]) &&
          !/^var\(--shadow-[a-z0-9-]+\)$/.test(bs[1].trim())
        ) {
          bad.push(
            `${styleRel}:${String(i + 1)}  box-shadow 里的 --shadow-* 只能**整条**用：${bs[1].trim().slice(0, 40)}`,
          );
        }
        // ③ var(--x, <字面量>) 的兜底不许是颜色
        for (const m of l.matchAll(/var\(--[a-z0-9-]+,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
          bad.push(`${styleRel}:${String(i + 1)}  var() 的兜底值不该是颜色：${m[0].slice(0, 40)}`);
        }
        tokenRefs += (l.match(/var\(--c-|var\(--shadow-/g) ?? []).length;
      });
  }
  // 令牌文件里同样不许出现"拼坏的整条值令牌"
  if (!exists(motionRel)) {
    bad.push(`${motionRel} 不在了 —— 这条守卫的定位器要跟着改`);
  } else {
    strip(read(motionRel))
      .split('\n')
      .forEach((l, i) => {
        const bs = /box-shadow:\s*([^;]+);/.exec(l);
        if (
          bs !== null &&
          /var\(--shadow-/.test(bs[1]) &&
          !/^var\(--shadow-[a-z0-9-]+\)$/.test(bs[1].trim())
        ) {
          bad.push(
            `${motionRel}:${String(i + 1)}  box-shadow 里的 --shadow-* 只能**整条**用：${bs[1].trim().slice(0, 40)}`,
          );
        }
      });
  }
  // 防失焦下限：令牌引用太少 ⇒ 扫描没走到该走的地方（恒绿比没有锁更坏）
  if (tokenRefs < 50) {
    bad.push(`只扫到 ${String(tokenRefs)} 处颜色令牌引用（少于 50 处）—— 扫描或样式表形状变了`);
  }
  report(
    '渲染层样式表里的颜色只许走令牌（整条值令牌不许被拼坏 · R42）',
    bad.length === 0,
    '颜色只许用 --c-* / --shadow-* 令牌（或由令牌派生的 color-mix）—— ' +
      '写死颜色就是"下一处漂移"，而**同一个主色两个值**更要命。\n     ' +
      bad.join('\n     '),
  );
}
/* ------------------------------------------------------------------ *
 * 31. Markdown 表格不得被空行切断（切断 ⇒ 渲染时后半截不是表格）
 *
 * 为什么立它（R55 · 2026-10-22 实测）：GFM 里**空行终止表格** ⇒ 空行之后的那段 `|` 行
 * **没有自己的表头** ⇒ 渲染成**纯文本**（一堆带竖线的墙），不是表格。
 * 本仓实测：`docs/TRACK-ROADMAP.md` 里有 **4 处**这种断点，其中一处是 **§4.1 队列**
 * （整个待办账）⇒ 渲染视图里前半截是表格、后半截是纯文本。
 *
 * 更要命的是**门禁自己跟着瞎了**：第 29 条（表格格数与表头一致）遇到不以 `|` 开头的行
 * （含空行）会把 `head` 置空 ⇒ 空行之后的行**全被当成"表头"** ⇒ **后半截一张也不比对**
 * ⇒ 连 T75 那行的裸竖线（`decidedBy:'policy' | 'person'`）都没人看。
 *
 * 判据：**表格行 → 空行 → 又是表格行，而那段没有自己的表头**（下一行不是分隔行）⇒ 红。
 * 修法两种都行：① 删掉那个空行（它多半是手滑）；② 给续表**补上自己的表头 + 分隔行**
 * （各成一张表 ⇒ 分组关系在渲染视图里也看得见，且第 29 条恢复覆盖）。
 * ------------------------------------------------------------------ */
{
  /** 与第 29 条同口径的分隔行判定（那条在自己的块作用域里，这里另立一份） */
  const sepRow = (l) => /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');
  const bad = [];
  let tableRows = 0;
  for (const rel of walkLiveFiles(['.md'])) {
    const lines = read(rel).split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      if (/^\s*```/.test(l)) {
        fence = !fence;
        continue;
      }
      if (fence || !l.startsWith('|')) continue;
      tableRows += 1;
      let j = i + 1;
      let blanks = 0;
      while (j < lines.length && lines[j].trim() === '') {
        j += 1;
        blanks += 1;
      }
      if (blanks === 0 || j >= lines.length || !lines[j].startsWith('|')) continue;
      if (j + 1 < lines.length && sepRow(lines[j + 1])) continue; // 续表自带表头 ⇒ 各成一张表
      bad.push(
        `${rel}:${String(i + 1)} 之后有空行，第 ${String(j + 1)} 行又来表格行，而那段**没有自己的表头**` +
          ' ⇒ 渲染时它不是表格（是一堆带竖线的纯文本），第 29 条对那段也不比对',
      );
    }
  }
  report(
    'Markdown 表格不得被空行切断（切断 ⇒ 渲染时后半截不是表格）',
    bad.length === 0 && tableRows > 100,
    [
      tableRows <= 100 ? `只扫到 ${String(tableRows)} 行表格 —— 定位器可能失效（防失焦先红）` : '',
      bad.join('\n     '),
    ]
      .filter(Boolean)
      .join('\n     '),
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
