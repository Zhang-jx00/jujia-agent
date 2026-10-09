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
import { homedir } from 'node:os';
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

/**
 * 「能力表声称了不存在的内建工具」这条注入用例的**保留哨兵名**。
 *
 * 为什么要专门设计它（而不是随手挑个工具名）：这类用例的靶子会被**成功**腐蚀 ——
 * M4 把 `run_command` 做出来之后，上一轮拿它当假工具的用例立刻失效（复核 028 的 K-3），
 * 再往前 M8 也冲掉过一次（复核 027 的 H-4）。每次都靠人记得换靶，就一定会再犯。
 *
 * 所以这里用一个**结构上不会被占用的名字**：以 `__selftest` 结尾。
 * 真实工具名一律是 `read_file` 这种小写下划线风格，谁也不会给产品能力起这种名字；
 * 下面还有一道前置断言：万一真被占用，直接报错说明原因，而不是让用例"没被拦住"再让人猜。
 */
const TOOL_SENTINEL = 'no_such_tool__selftest';

{
  const TOOL_SOURCES = [
    'packages/agent-core/src/tools/builtin/file-tools.ts',
    'packages/agent-core/src/tools/builtin/exec-tool.ts',
    'packages/agent-core/src/skills/tool.ts',
    'packages/agent-core/src/loop/agent-loop.ts',
  ];
  const taken = TOOL_SOURCES.filter((f) =>
    readFileSync(join(repoRoot, f), 'utf8').includes(TOOL_SENTINEL),
  );
  if (taken.length > 0) {
    fail(
      `保留哨兵名「${TOOL_SENTINEL}」已被 ${taken.join('、')} 占用 —— ` +
      '自检靶子会静默失效。请换一个仍以 __selftest 结尾的名字，并同步下面那条用例。',
    );
  }
}

/**
 * 「e2e 步数与脚本不一致」这条注入用例的锚点：数字**从脚本现读**，不写死。
 *
 * 为什么单独处理：本轮把 README 里的 20 步改成 21 步，写死的锚 `20 步全自动` 当场失效，
 * 自检直接报"锚点未命中"。这是"成功交付反而腐蚀自检靶子"这一类事故的**第四次**
 * （K-3 工具名、H-4 工具名、L-6 换了哨兵名、这次是数字）。
 * 前三次都在换靶子的**内容**，这次换的是靶子的**来源**：只要它抄本机数字，就一定会被下一次交付冲掉。
 */
const e2eScriptPath = 'apps/desktop/scripts/e2e-ui.mjs';
const realSteps = [...readFileSync(join(repoRoot, e2eScriptPath), 'utf8').matchAll(/^\s*step\(/gm)].length;
const readmeText = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const readmeSteps = Number(/e2e[^\n]*?(\d+) 步/.exec(readmeText)?.[1] ?? 'NaN');
if (!Number.isInteger(readmeSteps) || readmeSteps !== realSteps) {
  fail(
    `README 写的 e2e 步数（${String(readmeSteps)}）与脚本实际（${realSteps}）不一致 —— ` +
    '自检的靶子立在坏基线上，先把文档改一致再跑这个验证',
  );
}
const STEP_FROM = `${readmeSteps} 步全自动`;
const STEP_TO = `${readmeSteps + 3} 步全自动`;

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
    from: STEP_FROM,
    to: STEP_TO,
    expect: 'e2e 步数与脚本一致',
  },
  {
    // 用哨兵名注入，避免把真正的对标产品名再写一遍（哨兵在 check-docs 的清单里）
    name: '活文档里出现对标产品名',
    file: 'README.md',
    from: '## 核心理念与独特之处',
    to: '## 核心理念与独特之处（对标 __PEER_NAME_SELFTEST__）',
    expect: '没有对标产品名',
  },
  {
    name: 'IPC 通道数写错',
    file: 'README.md',
    from: '## 数据与目录（它把你的东西放哪了）',
    to: '## 数据与目录（33 个 IPC 通道，它把你的东西放哪了）',
    expect: 'IPC 通道数',
  },
  {
    // 断言源自交接验收抓到的真实漂移：能力表标 ✅ 却没有运行期通路。
    // 靶子用上面的**保留哨兵名**（以 __selftest 结尾，结构上不会被真实工具占用），
    // 锚点取不随步数/交付变动的行 —— 这两处都是被 H-4 / K-3 那两次"成功腐蚀靶子"教出来的。
    name: '能力表声称了不存在的内建工具',
    file: 'README.md',
    from: '| 审批决策 **edit**（允许但先改参数再执行） | ✅ |',
    to: `| 审批决策 **edit**（允许但先改参数再执行） | ✅ |\n| 删除文件 | ✅ 由 \`${TOOL_SENTINEL}\` 承担 |`,
    expect: '真实运行期通路',
  },
  {
    // 交接验收抓到 scripts/ 与 make-logo-mono.mjs 里写死过本机路径（后者还带用户名）。
    // 注入用运行时算出的 repoRoot，所以脚本里不含任何字面量本机路径。
    name: '代码里写死本机绝对路径',
    file: 'packages/shared/src/json-store.ts',
    from: 'export interface Envelope<T> {',
    to: `// 把本机路径写进代码 = 别人 clone 下来跑不了：${repoRoot}\nexport interface Envelope<T> {`,
    expect: '本机绝对路径',
  },
  {
    // 第 9 条只扫代码与配置；这条扫活文档里的**家目录全路径**（隐私类，含用户名那一层）。
    // 注入用运行时算出的 homedir()，本脚本自身同样不含任何本机路径字面量。
    name: '文档里写死本机用户主目录',
    file: 'README.md',
    from: '## 核心理念与独特之处',
    to: `## 核心理念与独特之处\n\n（临时证据：我的电脑在 ${homedir().split('\\').join('/')}）\n`,
    expect: '本机用户主目录',
  },
  {
    // M 状态行的受控词表（复核 046 的中间步）：把状态列换成表外词，这条检查必须咬。
    // 锚点取 M11 行 —— 它的内容不随每轮交付变动（M11 还没开工）。
    name: '里程碑状态行用了表外词',
    file: 'docs/TRACK-ROADMAP.md',
    from: '| M11 | **多模态与媒体** | ⏳ 未开始 → 轨道扩容 4 |',
    to: '| M11 | **多模态与媒体** | 等排期（自造词） |',
    expect: '受控词表',
  },
  {
    // CHANGELOG 标题的轨道段（复核 047 的补账要求，v0.51.0 起生效）：
    // 在真实 CHANGELOG 顶部注入一条**只有任务号**的假标题 —— 它必须被拦。
    // 版本号用一个明显不会真实出现的值，避免与将来的真条目混淆。
    name: 'CHANGELOG 标题只有任务号、没有轨道词',
    file: 'CHANGELOG.md',
    // 锚点用**文件头的说明行**（不随轮换变动）：原先锚的是某一条标题，而 CHANGELOG 每轮都会
    // 新增条目并把最旧一条搬进归档 —— 锚跟着被搬走，用例便"未命中"（R6c 撞到过一次）。
    from: '> 轨道分类见 `docs/TRACK-PLANS.md`；排期与修复队列见 `docs/TRACK-ROADMAP.md`。',
    to:
      '> 轨道分类见 `docs/TRACK-PLANS.md`；排期与修复队列见 `docs/TRACK-ROADMAP.md`。\n\n' +
      '## [v0.99.0-M9b] — 2099-01-01 00:00\n\n（自检注入的假条目）\n\n---\n',
    expect: '轨道段',
  },
  {
    // 规整11 护栏①（归轨索引的目录级覆盖）：把唯一盖住 `packages/agent-core/src/terminal/` 的那个条目
    // 改成一个不存在的目录名 —— 该目录就从"登记过"变成"没人登记"，必须咬。
    // 注入的是**索引条目本身**而不是代码目录，所以靶子不随每轮交付变动（目录改名才需要跟改）。
    name: '归轨索引漏登记一个源码目录',
    file: 'docs/TRACK-PLANS.md',
    from: '`packages/agent-core/src/terminal/`',
    to: '`packages/agent-core/src/terminal-selftest-removed/`',
    expect: '归轨索引',
  },
  {
    // 规整11 护栏②（复核台账标题的轨道词）：把**当前最新那条**的轨道词抹掉。
    // 锚点用 `## 复核 050` 的真实标题行 —— 台账只往末尾追加，老条目不回填，所以这条锚点稳定。
    name: '复核台账标题没有轨道词',
    file: 'review/REVIEW-LOG.md',
    from: '## 复核 050 · 扩容2（M9b 收口：B3 条件分支；里程碑轮）',
    to: '## 复核 050 ·（自检修掉的轨道词）M9b 收口',
    expect: '复核台账标题',
  },
  {
    // 规整11 护栏③（回退点标签必须真实存在）：把最新条目的回退点指向一个**不存在**的标签。
    // 靶子就是本轮实测抓到的那类错（文档写 v0.24.0-回归1，真标签其实是 v0.24.0-hg1）。
    // 锚点必须带上「回退点：」—— 同一版本号也出现在标题里，只换数字会打在标题上。
    name: '回退点标签不存在',
    file: 'CHANGELOG.md',
    from: '回退点：`v0.54.0-扩容2`',
    to: '回退点：`v0.54.0-扩容9`',
    expect: '回退点标签',
  },
  {
    // 规整11 护栏① 的**第二条断言路径**（段落定位器）：把 `### 2.1` 标题整段改名。
    // 为什么单独一条：第一版定位器写 `indexOf('### 2.1')`，实验把标题改成 `### 2.1x` 后护栏**照样绿**
    // —— 前缀还在就算匹配到（同 CSS 接线锁那次：子串检查对"改名保前缀"不敏感）。
    // 现在要求 `### 2.1` 后面紧跟空白，改名必须红；这条用例把这个修法钉住。
    name: '归轨索引段落标题被改名',
    file: 'docs/TRACK-PLANS.md',
    from: '### 2.1 代码文件归轨索引',
    to: '### 归轨索引（段落标题改名实验）',
    expect: '归轨索引',
  },
  {
    // T13 第一半：**"零测试也算过"回来时必须红**。
    // 这条比看上去重要：`passWithNoTests: true` 的失败模式不是报错，而是"收集到 0 个文件也退出 0"，
    // 于是整条测试门禁变成空转，而所有其他门禁照旧全绿。
    name: 'vitest 又允许"没有测试也算过"',
    file: 'vitest.config.ts',
    from: "    reporters: ['default'],",
    to: "    passWithNoTests: true,\n    reporters: ['default'],",
    expect: '测试收集范围',
  },
  {
    // T13 第二半：include 模式与磁盘上的测试文件**脱钩**时必须红。
    // 收窄一条模式 = 有一批文件永远不会被跑到，而这不会体现在任何计数里。
    name: '有测试文件不在收集范围内',
    file: 'vitest.config.ts',
    from: "      'apps/*/src/**/*.test.ts',",
    to: "      'apps/*/src/**/*.never-matches-selftest.ts',",
    expect: '测试收集范围',
  },
  {
    // T14：workflow 是一个没有任何东西盯着的 YAML —— 改个脚本名就静默少跑一步。
    // 注入一条引用**不存在脚本**的步骤，CI 一致性断言必须咬。
    name: 'workflow 引用了不存在的 npm 脚本',
    file: '.github/workflows/ci.yml',
    from: '      - name: 构建（main / preload / renderer）',
    to: '      - name: 自检注入的不存在步骤\n        run: npm run selftest-bogus-ci-step\n\n      - name: 构建（main / preload / renderer）',
    expect: 'CI 门禁清单',
  },
  {
    // 护栏 15（R6c）：本仓曾在 client.test.ts 里整块贴了两遍同一个 describe，
    // 三条用例各跑两遍、总数却看起来"覆盖够了"。重名标题必须咬得住。
    // 靶子选在**出事那个文件**：它同时也是"这条护栏为什么存在"的活证据。
    name: '同一文件里出现重名用例',
    file: 'packages/agent-core/src/mcp/client.test.ts',
    from: "  it('发送 initialize 并记录服务端信息与协议版本', async () => {",
    to:
      "  it('发送 initialize 并记录服务端信息与协议版本', async () => {\n" +
      "  it('发送 initialize 并记录服务端信息与协议版本', async () => {",
    expect: '测试用例标题在单文件内唯一',
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

console.log(`\nDOCS-CHECK SELFTEST OK：${cases.length} 处注入的漂移全部被拦住，还原后检查器恢复通过。`);
