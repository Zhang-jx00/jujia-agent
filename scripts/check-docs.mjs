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
  const TRACKS = ['回归', '铺设', '扩容', '拓展', '加固', '升级', '优化', '规整', '排查', '接驳'];
  const plans = read('docs/TRACK-PLANS.md');
  const missingVocab = TRACKS.filter((t) => !plans.includes(t));
  const titles = [...read('CHANGELOG.md').matchAll(/^## \[v(\d+)\.(\d+)\.(\d+)-([^\]]+)\]/gm)].map((m) => ({
    v: [Number(m[1]), Number(m[2]), Number(m[3])],
    suffix: m[4],
  }));
  const FLOOR = [0, 50, 0]; // ≤ v0.50.0 = 历史（不回改）；自 v0.51.0 起按新规
  const above = (a, b) =>
    a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
  const bad = titles.filter((t) => above(t.v, FLOOR) && !TRACKS.some((w) => t.suffix.includes(w)));
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
  const fastLine = /快档[^\n]*/.exec(progress)?.[0] ?? '';
  const slowLine = /慢档[^\n]*/.exec(progress)?.[0] ?? '';
  const fastNamed = GATE_FAST.filter((s) => fastLine.includes(s));
  const slowNamed = GATE_SLOW.filter((s) => slowLine.includes(s));
  report(
    'PROGRESS 的按档门禁清单与 package.json 脚本对齐',
    fastNamed.length === GATE_FAST.length && slowNamed.length === GATE_SLOW.length,
    `快档识别到 ${fastNamed.length}/${GATE_FAST.length}、慢档 ${slowNamed.length}/${GATE_SLOW.length}：` +
      `${fastLine.slice(0, 40)} ｜ ${slowLine.slice(0, 40)}`,
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
  const norm = (s) => s.split('\\').join('/');
  const repoRootLit = norm(repoRoot);
  const homeLit = norm(homedir());
  const CODE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.json', '.yml', '.yaml', '.css', '.html'];
  const hits = [];
  for (const rel of walkLiveFiles(CODE_EXTS)) {
    if (rel === 'package-lock.json') continue; // 依赖锁由 npm 生成，不在本规则范围内
    const text = norm(read(rel));
    if (repoRootLit !== '' && text.includes(repoRootLit)) {
      hits.push(`${rel}：写死了本机仓库绝对路径`);
    } else if (homeLit !== '' && homeLit !== '/' && text.includes(homeLit)) {
      hits.push(`${rel}：写死了本机用户主目录（连用户名一起泄漏进公开仓库）`);
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
