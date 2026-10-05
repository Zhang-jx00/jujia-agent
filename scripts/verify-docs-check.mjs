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
