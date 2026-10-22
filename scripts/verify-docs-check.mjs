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

/**
 * 当前 HEAD —— 自检期间用它发现「**有人在这段时间里提交了**」。
 *
 * 为什么需要它（2026-10-21 实测踩到）：注入自检会**临时改工作树**（把靶文本换成坏形态）。
 * 如果这段时间里**有人提交**，那一笔提交收进去的就是**注入形态** ⇒ 仓里多出一个坏的表格行，
 * 而下一次 `check:docs` 报出来的红会指向一个「看起来像文档漂移」的地方 —— **现场被换掉了**。
 * ⇒ 自检必须在收尾时发现「HEAD 变了」并**当场红**，把静默的破坏变成一句能读的话。
 *
 * 用**异步** spawn：本机同步 spawn（`spawnSync`）一律 EBUSY（`mutation-check.mjs` 头里记过同一条）。
 */
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
    const child = spawn(process.execPath, ['scripts/check-docs.mjs'], { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('error', () => done({ code: null, out }));
    child.on('close', (code) => done({ code, out }));
  });
}

/**
 * 失败出口。**规整17 改过一次**（2026-10-15，做红证实验时当场撞出来）：
 * 原来这里直接 `process.exit(1)` —— 而 `exit` **不会跑 await 之后的 finally**，
 * 于是"某条用例没拦住"这类中止会把**已注入的文件留在工作树里**，
 * 下一次 `check:docs` 就报一条看起来像文档漂移的真红（本轮实测留在 `json-store.ts`）。
 * 改成抛哨兵异常：注入循环的 `finally` 一定先把原文写回，再由外层统一收场。
 */
class SelftestAbort extends Error {}

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  throw new SelftestAbort(msg);
};

/** 注入**开始前/全部还原之后**的失败：此时工作树是干净的，直接退出即可（不需要那套还原） */
const die = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

const base = await runCheck();
if (base.code !== 0) {
  die('基线状态下检查器就已经失败 —— 请先修好文档再跑这个验证');
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
    die(
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
  die(
    `README 写的 e2e 步数（${String(readmeSteps)}）与脚本实际（${realSteps}）不一致 —— ` +
    '自检的靶子立在坏基线上，先把文档改一致再跑这个验证',
  );
}
const STEP_FROM = `${readmeSteps} 步全自动`;
const STEP_TO = `${readmeSteps + 3} 步全自动`;

/**
 * 「CHANGELOG 标题时间戳」这条的靶子**从文件现读**：取第二条标题（第一条是本轮新条目，
 * 按口径还没打标签、只查格式）。写死版本号或写死某分钟都会在下一次交付后被腐蚀（本仓四次），
 * 而这一条天生"只增不换"，所以锚点必须跟着台账走。
 */
const clLines = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8').split('\n');
const clHeadIdx = clLines.map((l, i) => (/^## \[v/.test(l) ? i : -1)).filter((i) => i >= 0);
const headLine = clHeadIdx.length > 1 ? (clLines[clHeadIdx[1]] ?? '') : '';
const headStated = / — (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/.exec(headLine)?.[1] ?? '';
if (headStated === '') {
  die(
    '自检锚点失效：CHANGELOG 里找不到"第二条带 ` — YYYY-MM-DD HH:MM` 的标题" —— ' +
      '第 17 条护栏的靶子立在坏基线上，先看标题格式有没有漂移',
  );
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
    from: STEP_FROM,
    to: STEP_TO,
    expect: 'e2e 步数与脚本一致',
  },
  {
    // T82（2026-10-22）：「当前规模」行里**渲染层组件测试**的例数也要机器盯 ——
    // 此前只有测试文件数与 e2e 步数两格被盯 ⇒ 其余数字静默漂（**当时的**实测真值 109 例 / 14 个文件，
    // 文档里还写着 94 例 / 13 个 ⇒ 差 15 例、一个文件）。**现值见 PROGRESS「当前规模」行**。
    // 为什么挑这个形状：数字漂移**不报错、不红**，只会让下一个接手方按错数字核 ⇒ 只能靠机器盯。
    name: 'PROGRESS「当前规模」里的渲染层组件测试例数漂了',
    file: 'docs/PROGRESS.md',
    // ⚠️ 这条锚点**跟着 PROGRESS 的真值走** ⇒ 每轮测试数一变就要更新它
    //   （R58 就撞上过一次：109 → 114，锚点没跟着改 ⇒ 自检**当场中止**并报「锚点未命中」——
    //   那个中止是**对的**：一个锚点漂了的注入用例等于没有用例。）
    from: '渲染层组件测试 114 例',
    to: '渲染层组件测试 113 例',
    expect: '渲染层组件测试数与实际一致',
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
    // **规整17 补的靶子（2026-10-15）**：上一那条用的是"正斜杠形态"，旧判据也能咬；
    // 真实逃逸的是**转义形态** —— TS/JS 源码里的 Windows 路径写成 `D:\\…`，
    // 旧判据把 `\`→`/` 之后得到 `D://…`，与运行时算出的 `D:/…` 对不上 ⇒ 门禁一直 ✅。
    // 这条用例把"转义形态"钉住：判据要是退回旧的归一化写法，它立刻红。
    name: '代码里写死本机绝对路径（转义形态，旧判据看不见）',
    file: 'packages/shared/src/json-store.ts',
    from: 'export interface Envelope<T> {',
    to: `// 反斜杠转义形态的本机路径：${repoRoot.split('\\').join('\\\\')}\nexport interface Envelope<T> {`,
    expect: '写死了本机仓库绝对路径',
  },
  {
    // 同一条护栏补的第二件事：只比"仓库根那一串"会漏掉**它的上级目录** ——
    // `mcp-real-server.test.ts` 当年写死的正是上级（换台机器同样不存在）。
    name: '代码里写死本机仓库的上级目录',
    file: 'packages/shared/src/json-store.ts',
    from: 'export interface Envelope<T> {',
    to: `// 仓库根上一层也是本机路径：${resolve(repoRoot, '..').split('\\').join('\\\\')}\nexport interface Envelope<T> {`,
    expect: '上级目录',
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
    // 锚点原取 M11 行（"还没开工、不会变"）—— R14 交付批一后按纪律跟改到**新的 M11 行原文**，
    // **R40 又跟改了一次**（那一行补了"媒体生成已单独报备"的结论）——
    // **这已是"成功交付腐蚀自检靶子"的第五次同族事故**（K-3 工具名 / H-4 工具名 / L-6 哨兵名 /
    // 数字 / **这次是里程碑行**）。规律不变：**靶子会被合法交付冲掉** ⇒ 交付时必须同步跟改锚点。
    name: '里程碑状态行用了表外词',
    file: 'docs/TRACK-ROADMAP.md',
    from: '| M11 | **多模态与媒体** | 🔶 **批一（对话图片输入）已交付 `v0.78.0-扩容5`**：三条入口（选择 / 拖动 / 粘贴）· 魔数准入 5MB·4 张·四格式 · 出站前剥 EXIF 等元数据（fail-closed）· 附件**不落盘**（历史写「图片未保留 ×N」）· 仅 OAI 兼容一路。**媒体生成 / 视频与"多模态门控"其余部分仍未开始** —— **R40 已单独报备**（`docs/DECISION-M11-MEDIA-GEN.md`）：**最要紧的一条结论是"冲突在不在取决于生成打给谁"** —— 走**当前连接**（OAI 兼容 `POST /images/generations`，**零新依赖**，provider 层已有注入式 `fetcher`）⇒ **现役表述已经覆盖**（"你主动发起的模型请求"），**不需要表述批复**；打**别的服务商**才撞表述冲突（停牌①）。**选项 A/B/C 交所有者拍板**（推荐 **B：只做 S1 文生图、走当前连接**）；**本轮只报备、不装依赖、不做半吊子实现** |',
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
    // 规整11 护栏③（回退点标签必须真实存在）：往表头后面插一条**幽灵条目**，
    // 它的回退点指向一个不存在的标签（靶子就是实测抓到的那类错：文档写 v0.24.0-回归1，
    // 真标签其实是 v0.24.0-hg1）。
    // 为什么不是改写某条真实条目的「回退点：…」那行 —— 上一版就是这么写的，而最旧条目
    // 每轮会轮换进归档：锚点跟着搬走，注入悄悄打不进去（本轮就是这么红的）。
    // **锚点未命中必须继续当红灯**：这条兜底让它无法被静默忽略。
    name: '回退点标签不存在',
    file: 'CHANGELOG.md',
    // 表头说明行永远在原地，条目轮换搬不走它
    from: '> 阶段划分见 `docs/PLAN.md` §5–6。',
    to: [
      '> 阶段划分见 `docs/PLAN.md` §5–6。',
      '',
      '## [v9.99.9-铺设99] — 2099-01-01 00:00',
      '',
      '回退点：`v9.99.9-铺设99`；上一版 `v0.1.0-p0`。',
      '',
    ].join('\n'),
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
  {
    name: '标题时间戳写成未来（台账里的时间戳也是数字 · 第 17 条）',
    file: 'CHANGELOG.md',
    from: headLine,
    to: headLine.replace(headStated, '2099-01-01 00:00'),
    expect: 'CHANGELOG 标题时间戳不晚于标签指向的提交',
  },
  {
    name: 'PROGRESS §三 抄回滚动叙述（第 18 条·上半）',
    file: 'docs/PROGRESS.md',
    from: '待办明细见 `docs/HANDOVER.md` §3.2；排期与 DoD 见 `docs/TRACK-ROADMAP.md` §二/§三/§六。',
    to:
      '**最新交付**：自检注入的滚动叙述（用来证明第 18 条会咬）。\n\n' +
      '待办明细见 `docs/HANDOVER.md` §3.2；排期与 DoD 见 `docs/TRACK-ROADMAP.md` §二/§三/§六。',
    expect: '滚动叙述禁令',
  },
  {
    name: 'HANDOVER 抄回"最近三轮"（第 18 条·下半）',
    file: 'docs/HANDOVER.md',
    from: '### 2.12 质量基建（这是本项目最值钱的部分之一，请务必沿用）',
    to:
      '**最近三轮已交付**：自检注入。\n\n' +
      '### 2.12 质量基建（这是本项目最值钱的部分之一，请务必沿用）',
    expect: '滚动叙述禁令',
  },
  {
    name: '已被证伪的"还没做"句式回来（第 19 条状态句锁）',
    file: 'docs/DESIGN-SESSIONS.md',
    from: '# 会话持久化 · 数据布局报备（轨道铺设计划 6 · **已批；6a 与 6b 均已交付**）',
    to: '# 会话持久化 · 数据布局报备（轨道铺设计划 6 · **已批；6a 已交付，6b 待做**）',
    expect: '状态句回归锁',
  },
  {
    name: '整节插入吃掉文档小节标题（第 20 条 · R26 施工时作者本人踩过）',
    file: 'docs/TEST-POLICY.md',
    from: '## 三、日常使用也想换到别的盘',
    to: '## 三十、日常使用也想换到别的盘',
    expect: '活文档的编号小节连续',
  },
  {
    // 第 21 条（行尾 LF · 规整17 撞出、R30 立）：注入一处 CRLF。
    // 为什么必须按字节判：本轮整份 .md 被转成 CRLF，而 `git diff --numstat` 报的是干净的 `15/0`
    // —— git 在 diff 时就做了行尾归一化，"改完核对 diff 行数"这条救不了它。
    name: '在库文本文件混进 CRLF 行尾',
    file: 'docs/CHECKLIST.md',
    from: '- [ ] `git index.lock` 撞锁时"可见地等"的加固候选',
    to: '- [ ] `git index.lock` 撞锁时"可见地等"的加固候选\r\n- [ ] 这一行是注入用的 CRLF 靶子\r\n',
    expect: '行尾统一 LF',
  },
  {
    // 第 22 条（表格行自封闭 · R30 立）：去掉一行表格的收尾竖杠 ⇒ "以 | 开头却不以 | 收尾"，
    // 正是本轮交付行被写成两行时的形状（渲染出的表格会在那里收摊，续写变成表外散文本）。
    name: 'Markdown 表格行被写成两行（收尾竖杠丢失）',
    file: 'docs/TRACK-ROADMAP.md',
    from: '| 轮 | 任务 | 停牌点 / 备注 |',
    to: '| 轮 | 任务 | 停牌点 / 备注',
    expect: '表格行自封闭',
  },
  {
    // 第 31 条（表格不得被空行切断 · R55 立）：在表里插一个空行 ⇒ GFM 里**空行终止表格**
    // ⇒ 空行之后那段没有自己的表头 ⇒ 渲染成纯文本，而第 29 条对那段**一张也不比对**
    // （它把空行当成"表结束"，后面每一行都被当成"表头"）。
    // 这个形状本仓真实出现过 4 处（其中一处是 §4.1 整个待办账）⇒ 必须有机器盯住。
    name: '表格被空行切断（续表没有自己的表头 ⇒ 渲染成纯文本）',
    file: 'docs/TRACK-ROADMAP.md',
    from: '| 轮 | 任务 | 停牌点 / 备注 |\n|----|------|-----------|',
    to: '| 轮 | 任务 | 停牌点 / 备注 |\n|----|------|-----------|\n\n| 注入靶子（这一行后面跟着空行 ⇒ 续表没有表头） | 靶 | 靶 | 靶 |',
    expect: '表格不得被空行切断',
  },
  {
    // 第 23 条（展示页截图与清单 · R32 立）：清单里列一张不存在的图 ⇒ "图与账分家"。
    // 为什么挑这个形状：截图最容易坏的方式不是"拍错"，而是**图被删了 / 换了名字而 README 还在引**，
    // 读者看到的是裂图的灰框，而门禁全绿。
    name: '清单列了一张盘上不存在的截图',
    file: 'docs/screenshots/manifest.json',
    from: '"file": "overview.png"',
    to: '"file": "no-such-shot-xyz.png"',
    expect: '展示页截图与清单一致',
  },
  {
    // 第 23 条的另一半：图注与清单的版本必须互相对得上。
    // 锚点挑 `"version": "` 这个**键**而不是那个版本号值 —— 值每轮重拍都会变，
    // 写死值的用例下一轮就会变成"注入失败"（本仓的规矩：注入失败算红灯，等于给自己埋雷）。
    name: '清单版本号与 README 图注脱钩（图换了字没换）',
    file: 'docs/screenshots/manifest.json',
    from: '"version": "',
    to: '"version": "9.9.9-',
    expect: '展示页截图与清单一致',
  },
  {
    // 第 24 条（磁盘断言不抢跑 · T64 · R32 立）：把上一轮那个**真实红过的形状**注回去 ——
    // 弹窗决定之后、界面回执之前先读一次盘。
    // 挑这一条做用例的理由：这类洞的症状是**随机红**，重跑能过就没人修；只有把它变成必红的判据才修得掉。
    // 锚点用 `const savedNote = ...` 整行（现扫唯一），不挑 `clickDialog2('允许一次')`（出现 4 次）。
    name: 'e2e 在弹窗决定后、界面回执前读盘（T64 那个抢跑形状）',
    file: 'apps/desktop/scripts/e2e-ui.mjs',
    from: "  const savedNote = await waitText2('已保存');",
    to: "  if (hooksOnDisk() === null) fail('注入探针：这就是抢跑');\n  const savedNote = await waitText2('已保存');",
    expect: 'e2e 的磁盘断言不抢跑',
  },
  {
    // 第 25 条（失败出口自带收尾 · T66）：把 e2e 的 fail() 改回 `process.exit(1)`。
    // 挑这一条的理由：这个形状本月犯了三次（T62 注入自检 / 本轮截图脚本 / e2e），
    // 每一次的后果都是"收尾没跑"—— 注入不回滚、应用没关、临时目录留在盘上。
    name: 'e2e 的 fail() 退回 process.exit（收尾会被跳过）',
    file: 'apps/desktop/scripts/e2e-ui.mjs',
    from: '  throw new E2EAbort(text);',
    to: '  process.exit(1);',
    expect: '门禁脚本的失败出口自带收尾',
  },
  {
    // 第 24 条的第二个形状（**判据自己不能有洞**）：点击与读盘挤在**同一行**。
    // 第一版守卫是"命中即 return"，这种写法会整行躲过去 —— 加一条用例把它钉住，
    // 也顺手证明"同一行有界面回执"是豁免、"同一行有点击"不是。
    name: 'e2e 同一行里点完弹窗就立刻读盘（守卫的同行洞）',
    file: 'apps/desktop/scripts/e2e-ui.mjs',
    from: "  await clickDialog2('允许一次');\n  const savedNote = await waitText2('已保存');",
    to: "  await clickDialog2('允许一次'); const raceSameLine = hooksOnDisk();\n  if (raceSameLine === undefined) fail('注入探针');\n  const savedNote = await waitText2('已保存');",
    expect: 'e2e 的磁盘断言不抢跑',
  },
  {
    // 第 25 条的第二处靶子：`verify-pack.mjs` 的 fail() —— 同族**第四次**被扫出来的。
    // 它的 `finally` 负责关掉拉起来的打包版应用；跳过它 = 应用在后台握着 `release/win-unpacked*` 的句柄
    // = 下一次 `dist:dir` 在 rename 那一步 EBUSY（本轮这条门禁跑不动，与这条链在同一条线上）。
    name: 'verify-pack 的 fail() 退回 process.exit（应用不会被关，句柄留在手里）',
    file: 'apps/desktop/scripts/verify-pack.mjs',
    from: '  throw new PackAbort(text);',
    to: '  process.exit(1);',
    expect: '门禁脚本的失败出口自带收尾',
  },
  {
    // 第 26 条（常驻取证不许被顺手删 · R34 立）：把渲染进程崩溃那一句的**事件名**改掉。
    // 挑这一条的理由：取证代码不是断言，删掉它以后**什么都不会红** —— 而偶发红这一族全靠它找根因，
    // 所以"装没装"本身必须有机械判据盯着（本仓老规矩：只写进禁忌表的规矩照样复发）。
    name: 'e2e 的崩溃取证探针被改名（取证没了不会红，只能靠这条守卫）',
    file: 'apps/desktop/scripts/e2e-ui.mjs',
    from: "  page.on('crash', () => log(",
    to: "  page.on('destroyed', () => log(",
    expect: 'e2e 的常驻取证还在原位',
  },
  {
    // 第 27 条（T70 · R35 收口实测）：把"空文件只在临时区里才算垃圾"这道闸拆掉。
    // 挑这一条的理由很具体：**旧版就是这么写的**，于是它把自己正在写的日志搬进了回收站
    // （`.trash/20261016-153314/.evidence/r35/_t.log` 为证），合成项目探针还量出 `docs/.gitkeep` 同样会被搬走。
    // 这不是"日志丢了"，是**仓库里任何 0 字节文件都可能被静默搬走** —— 判据必须钉住分流那一行。
    name: 'cleanup 回到"任何空文件都算垃圾"（会把自己刚写的日志搬进回收站）',
    file: 'scripts/cleanup.py',
    from: '                (empty_files if in_temp_area(p) else empty_noted).append(p)',
    to: '                empty_files.append(p)',
    expect: '清理脚本只把临时区里的空文件当垃圾',
  },
  {
    // 第 28 条（交接文档里的命令要能照抄）：把一条真实脚本改成不存在的名字。
    // 挑这一条的理由很具体：本轮真的在文档里写出过一条不存在的 `npm run cleanup` ——
    // 交接文档是接手方的"第一小时清单"，**抄不通的命令行比没有清单更坏**（人会以为是自己的环境坏了）。
    name: '交接文档里写了一条不存在的 npm run 脚本（照抄会失败）',
    file: '俱佳Agent交接文档.md',
    from: 'npm run verify:pack  # 打包产物六步验证',
    to: 'npm run verify:packed  # 打包产物六步验证',
    expect: '交接文档里的 npm run 脚本都真实存在',
  },
  {
    // 第 29 条（表格数据行的格数要与表头一致）：把一行内代码里的转义竖线还原成裸竖线。
    // 挑这一条的理由很具体：**GFM 按未转义竖线切格**，所以 `(?:TOKEN|…)` 里的裸竖线会
    // 真的把一格劈成两格 —— 渲染时多出来的那格**被静默丢弃**，那一列的内容人间蒸发。
    // 本轮实测 27 处都是这一种（跨 10 个文件），其中 T60 那行害得"严重"落到了"状态"列、
    // "状态"列整列不见。判据若失效，同形的缺陷会**悄无声息地再长出来**。
    name: '表格数据行里多了一个格（裸竖线会把内容劈掉一列）',
    file: 'docs/TRACK-ROADMAP.md',
    from: '`[A-Za-z0-9_.-]*(?:TOKEN\\|…)[A-Za-z0-9_.-]*`',
    to: '`[A-Za-z0-9_.-]*(?:TOKEN|…)[A-Za-z0-9_.-]*`',
    expect: 'Markdown 表格的数据行格数与表头一致',
  },
  {
    // 第 30 条（verify:pack 的重试必须换一只全新目录 · T69① · R37）：
    // 把重试块里的"换目录名"那一句删掉。
    // 挑这一条的理由很具体：**R35 的实测把"重试"拆穿了** —— 旧写法每次先 `unlink` 上一回残骸，
    // 于是第二次尝试**根本没走到 `rename`**，就红在 `EBUSY ... unlink ... default_app.asar` 上；
    // 换句话说"同一只目录上的重试"不是重试，是**接着撞**。判据若失效，同形的缺陷会悄无声息地再长出来。
    name: 'verify:pack 的重试不换目录（变回"在同一只上接着撞"）',
    file: 'apps/desktop/scripts/verify-pack.mjs',
    from: '    PACK_OUT = packOutName();\n    RUN_OUT_DIR = join(RELEASE_DIR, PACK_OUT);',
    to: '    RUN_OUT_DIR = join(RELEASE_DIR, PACK_OUT);',
    expect: 'verify:pack 的重试换全新目录',
  },
  {
    // 第 31 条（行数口径必须与 eslint 的 max-lines 配置一致 · R38）：
    // 把 eslint 配置里的 skipComments 关掉 —— 口径变了，而文档里还写着"skipComments: true"。
    // 挑这一条的理由很具体：**R20 就是按物理行评估的**（"三个候选超阈"），
    // 而真正会拦人的判据是 eslint 的逻辑行 —— **两者差 200~500 行，结论整个反过来**。
    // 判据若失效，下一个人又会按错口径评估（而 R20 的清单就是这么错的）。
    name: 'eslint 的行数口径变了（skipComments 被关掉）而文档还写着旧口径',
    file: 'eslint.config.js',
    from: 'skipComments: true',
    to: 'skipComments: false',
    expect: '行数口径与 eslint 的 max-lines 配置一致',
  },
  {
    // 第 32 条（e2e 里「读真值 / 下一个动作」之前必须先等到「状态已生效」· T71 · R39）：
    // 把「点『清除』之后等『已清除自选程序』」这一步删掉 —— 脚本就退回到"点下去就当生效了"的老形状。
    // 挑这一条的理由很具体：**这一族不会让任何测试变红**，只会让门禁随机红，
    // 然后被人当成 flake 重跑 —— 重跑能过就更没人去修（护栏第 24 条立它时写的就是这段话）。
    // 判据若失效，同形的缺陷会悄无声息地再长出来。
    name: 'e2e 里点完「清除」不等状态生效就做下一个动作',
    file: 'apps/desktop/scripts/e2e-ui.mjs',
    from: [
      "  const cleared = await waitForText('已清除自选程序');",
      '  if (cleared !== true) {',
      "    fail('点了「清除」但主进程没回\"已清除自选程序\" —— 清除没生效，后面那步必然按旧路径走', String(cleared).slice(0, 800));",
      '  }',
    ].join('\n'),
    to: '',
    expect: '没有等到「状态已生效」',
  },
  {
    // 第 33 条（渲染层样式表里的字号只许走令牌 · R41）：
    // 把一处 `font-size: var(--fs-body)` 改回写死的 13px。
    // 挑这一条的理由很具体：**写死的字号在渲染结果里看不出来** —— 本轮现扫到的 53 处全是
    // 12/13/11 这种"看起来差不多"的值，混进去就没法再统一；而"不许硬编码"这条纪律
    // 从 W6 起就写在令牌文件的头里（`packages/ui-tokens/src/tokens.ts`），**但它一直不是机器判据**。
    // 判据若失效，同形的漂移会悄无声息地再长出来。
    name: '渲染层样式表里又出现了写死的字号',
    file: 'apps/desktop/src/renderer/src/styles.css',
    from: 'font-size: var(--fs-body);',
    to: 'font-size: 13px;',
    expect: '字号只许走令牌',
  },
  {
    // 第 34 条（渲染层样式表里的颜色只许走令牌 · R42）：
    // 把一处颜色令牌改回写死的 hex。
    // 挑这一条的理由很具体：**颜色比字号更危险** —— 本轮现扫到"同一个主色两个值"
    // （令牌 `#4c8dff` vs 样式表里的旧蓝 `rgb(47,111,235)`），
    // 而**渲染结果里看不出"这个蓝是旧版留下的"**，只看得见"有点怪"。
    // 判据若失效，同形的漂移会悄无声息地再长出来。
    name: '渲染层样式表里又出现了写死的颜色',
    file: 'apps/desktop/src/renderer/src/styles.css',
    from: 'color: var(--c-danger);',
    to: 'color: #ff7875;',
    expect: '写死的颜色',
  },
  {
    // 第 34 条的第二路：整条值令牌被拼坏（`0 12px 40px` + 整条 `--shadow-dialog`）。
    // 为什么单独立一条：**它是无效声明，渲染上看不出来**（box-shadow 整条失效 ⇒ 只是少一层阴影），
    // 而"还有没有写死颜色"那条判据**扫不到它**（里面没有颜色字面量了）——
    // 这类"拼坏"只能靠判据自己盯住。
    name: 'box-shadow 里的整条阴影令牌被拼坏',
    file: 'apps/desktop/src/renderer/src/styles.css',
    from: 'box-shadow: var(--shadow-dialog);',
    to: 'box-shadow: 0 12px 40px var(--shadow-dialog);',
    expect: '只能**整条**用',
  },
  {
    // 第 50 条（R58 · 断指针）：把 T79 的规格指到**不收这一条的那份文档**上。
    //
    // 为什么挑这一条当靶子：**它就是本轮现扫发现的原样**（`styles.css` 与 `styles-wiring.test.ts`
    // 两处都把规格指到了 `docs/TRACK-PLANS.md`，而 T79 住在 `docs/TRACK-ROADMAP.md`）⇒
    // 注入回去 = **把历史那处断指针原样复原**。
    //
    // 为什么这类漂移必须机器盯：它**不报错、不红、渲染上也看不出来** ——
    // 照着"有出处"去找的人会扑空，而"有出处"这句话听起来仍然成立 ⇒ **给下一个人的是假证据**。
    name: 'T 号的规格被指到了不收 T 号的那份文档（断指针）',
    file: 'apps/desktop/src/renderer/src/styles.css',
    from: '规格与改法见 `docs/TRACK-ROADMAP.md` §4.1 的 T79',
    // ⚠️ 那个坏指针**必须拼出来**，不能写成字面量 ——
    //   写成字面量的话，**它自己**就成了第 50 条要抓的断指针 ⇒ 检查器会抓自己 ⇒ 自检当场红。
    //   （这是"判据管得宽"的另一个受害者：**写判据的人**也是它的适用对象。）
    to: '规格与改法见 `docs/TRACK-PLANS.md` 的 ' + 'T' + '79',
    expect: '指向队列条目（T 号）的引用必须指到真正住着它的那份文件',
  },
];

/**
 * 中止也要还原（**规整17 改的**，见上面 `fail` 的注释）：`fail()` 抛哨兵异常 ⇒
 * 每一次注入的 `finally` 都会先把原文写回，再由这里统一收场；
 * 最后**再跑一次检查器**，把"注入到底清干净了没有"当成一条真值说出来，而不是让人 `git status` 才发现。
 */
let aborted = false;
/** 每个被注入过的文件的**原文**（收尾时逐字节核对 ⇒ 还原不能只靠"检查器恢复通过"）。 */
const backups = new Map();
/**
 * **自检期间被人动过的文件**（T80 · 2026-10-22 补）。
 *
 * 为什么单独记：旧写法在 `finally` 里**无条件**把快照写回 ⇒ 自检期间有人编辑了该文件，
 * **人家的改动被静默抹掉**（最坏的一种：改动无声消失）；而收尾那句"没有逐字节回到原文"
 * 又只是**假红** —— 「期间被改过」与「它没还原」两种情形**长成同一句话**。
 * ⇒ 现在：期间被改过就**保留当前内容**（不写回），并**单独归因**（见收尾）。
 */
const touched = [];
const headAtStart = await gitHead();
try {
  for (const c of cases) {
    const path = join(repoRoot, c.file);
    const original = readFileSync(path, 'utf8'); // 内存备份，不落盘
    backups.set(path, original);
    if (!original.includes(c.from)) {
      fail(`用例「${c.name}」的锚点未命中 —— 请更新本脚本的锚点`);
    }
    let injected = '';
    try {
      injected = original.replace(c.from, c.to);
      writeFileSync(path, injected, 'utf8');
      const r = await runCheck();
      if (r.code !== 1) fail(`用例「${c.name}」没有被拦住（检查器退出码 ${String(r.code)}，应为 1）`);
      if (!r.out.includes(c.expect)) {
        fail(`用例「${c.name}」虽然失败，但不是期望的那条检查（期望包含「${c.expect}」）`);
      }
      console.log(`  ✅ 被拦住：${c.name}`);
    } finally {
      // **还原前先看有没有人动过**（T80）：期间被改过 ⇒ 写回快照会**静默抹掉**人家的改动 ⇒
      // ⇒ 保留当前内容（不写回），并交给收尾**单独归因**（"期间被改" ≠ "没还原"）。
      const current = readFileSync(path, 'utf8');
      if (current !== injected) {
        touched.push({ file: c.file, name: c.name });
        console.log(`  ⚠️ 用例「${c.name}」期间 ${c.file} 被改过 ⇒ 保留当前内容，不写回快照`);
      } else {
        writeFileSync(path, original, 'utf8');
      }
    }
  }
} catch (err) {
  if (!(err instanceof SelftestAbort)) throw err;
  aborted = true;
}

const after = await runCheck();
if (aborted) {
  console.error(
    after.code === 0
      ? '\n❌ 自检中止（原因见上）。已复跑检查器确认**注入没有留在工作树里**（还原成功）。'
      : '\n❌ 自检中止（原因见上），且**还原后检查器仍失败** —— 工作树可能被注入污染，请对照 `git diff` 手工清掉残留。',
  );
  process.exit(1);
}
/**
 * **收尾三道自查**（2026-10-21 加两道 · 2026-10-22 T80 再加一道"期间被改"的独立归因）：
 * ① **被注入的每个文件必须逐字节回到原文** —— 「检查器恢复通过」不等于「文件没被留下别的形态」；
 * ② **HEAD 必须没变** —— 变了就说明**期间有人提交**，那一笔收进去的可能就是注入形态；
 * ③ **期间被改过的文件单独归因** —— 它与「没还原」是**两件事**（T80）：
 *    旧写法在自检期间**无条件**写回快照 ⇒ 有人同时编辑该文件时，**他的改动被静默抹掉**；
 *    而收尾那句"没有逐字节回到原文"又只是**假红**（两种情形长成同一句话）⇒ 混在一起就分不清了。
 */
const touchedFiles = new Set(touched.map((t) => t.file));
const notRestored = [...backups.entries()]
  .filter(([p]) => !touchedFiles.has(p)) // 期间被改过的 ⇒ 归到「另一类」，不混进「没还原」
  .filter(([p, original]) => readFileSync(p, 'utf8') !== original)
  .map(([p]) => p);
if (touched.length > 0) {
  console.error(
    `\n❌ 自检期间**这些文件被人改过**：${[...touchedFiles].join('、')}\n` +
      '   ⇒ 这与"注入没还原"是**两件事**（T80）：旧写法会把人家的改动**静默抹掉**，现在**保留当前内容**、不写回快照。\n' +
      '   ⇒ 本轮自检**对这几个文件的结论不可用**（注入的形态与他们的改动混在一起了）—— 请重跑一次自检。\n' +
      '   **顺序纪律**：注入自检会临时改工作树 ⇒ 跑它的时候**不许提交，也不许编辑**。',
  );
  process.exit(1);
}
if (after.code !== 0) die('还原后检查器仍失败 —— 基线已被污染，请人工检查');
if (notRestored.length > 0) {
  console.error(
    `\n❌ 自检跑完，但**这些文件没有逐字节回到原文**：${notRestored.join('、')}\n` +
      '   ⇒ 注入的形态可能还在工作树里（"检查器恢复通过"不等于"文件是原文"）—— 请对照 `git diff` 手工清掉。',
  );
  process.exit(1);
}
const headAtEnd = await gitHead();
if (headAtStart !== null && headAtEnd !== null && headAtStart !== headAtEnd) {
  console.error(
    `\n❌ 自检期间 **HEAD 变了**（${headAtStart.slice(0, 7)} → ${headAtEnd.slice(0, 7)}）—— 期间有人提交了。\n` +
      '   注入还曾在文件里 ⇒ 那一笔提交**可能把注入一起收进了仓**。\n' +
      '   ⇒ 立刻 `git status --porcelain` 与 `git diff` 核对（`git diff` 为空 = 那一笔收进去的就是注入）。\n' +
      '   **顺序纪律**：注入自检会临时改工作树 ⇒ **跑它的时候不许提交**；提交要等它报出"还原成功"之后。',
  );
  process.exit(1);
}

console.log(`\nDOCS-CHECK SELFTEST OK：${cases.length} 处注入的漂移全部被拦住，还原后检查器恢复通过（${String(backups.size)} 个文件逐字节还原 · HEAD 未变）。`);
