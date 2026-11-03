#!/usr/bin/env node
/**
 * 锁可信度判据的**自检**（R83 · 对应 `scripts/check-lock-trust.mjs`）。
 *
 * ## 为什么要有它
 *
 * 判据自己如果不能被证伪，那它就是一把**永远绿**的锁 —— 正是本轮要清的那一类。
 * 所以每条规则都配了**红例与绿例**：
 *   · **红例**：造一条真的会骗人的锁 ⇒ 判据必须报出对应规则；
 *   · **绿例**：造一条合规的锁 ⇒ 判据**不许**报它（判据乱报比不报更坏 —— 那会让人开始忽略输出）。
 *
 * 两个方向都要有：只写红例，判据就可能是因为"什么都报"而红的。
 *
 * ## 特别地：R70 那条历史案例
 *
 * `R70-D` 用的是本仓真实踩过的那条锁（标题写着「ISC 要求随副本保留」，
 * 断言只查「模块里有这个字符串」）⇒ 判据必须当场逮住它。
 * **这条就是本轮判据存在的理由**，它必须红；哪天它不红了，这个自检就失败。
 *
 * 用法：node scripts/verify-lock-trust-check.mjs
 * 退出码：0 = 自检通过；1 = 有规则没红或有绿例被误报；2 = 环境错
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(repoRoot, 'scripts', 'check-lock-trust.mjs');
const fixtureRoot = join(repoRoot, '.tmp', 'verify-lock-trust');

if (!existsSync(checker)) {
  console.error(`找不到判据脚本：${checker}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 夹具：**一例一文件**
 * ------------------------------------------------------------------ *
 *
 * 为什么一例一文件：红例与绿例的**标题必须完全一样**（只有断言体不同），
 * 放在同一个文件里就没法把"红例那条的发现"和"绿例那条的发现"分开 ⇒ 会自己骗自己。
 * 一例一文件 ⇒ 匹配只看文件名，判定不含糊。
 */

/** 一个文件放一条锁 */
function fixtureFile(c) {
  const body = c.body.map((l) => `    ${l}`).join('\n');
  return `import { describe, expect, it } from 'vitest';\n\ndescribe('夹具', () => {\n  it('${c.title}', () => {\n${body}\n  });\n});\n`;
}

const CASES = [
  {
    id: 'R-A 红：标题说不许，断言体里却一条会失败的断言都没有',
    title: '不许出现任何裸字符串通道',
    body: ['const names: string[] = [];', 'void names;'],
    expectRule: 'R-A',
  },
  {
    id: 'R-A 绿：同样说不许，但有一条会失败的断言',
    title: '不许出现任何裸字符串通道',
    body: ["expect(names.join(' ')).not.toContain('raw');"],
    expectRule: null,
  },
  {
    id: 'R-B 红：声称每个都管，但断言体里既没遍历也没计数',
    title: '每个图标都必须渲染出 svg',
    body: ['expect(svg).not.toBeNull();'],
    expectRule: 'R-B',
  },
  {
    id: 'R-B 绿：同样声称每个都管，但真的遍历了',
    title: '每个图标都必须渲染出 svg',
    body: ['for (const icon of icons) {', '  expect(icon).not.toBeNull();', '}'],
    expectRule: null,
  },
  {
    id: 'R-B 绿（结构不变量形态）：不写循环，但把全体翻译成计数比较',
    title: '每一类流事件都必须带 sessionId',
    body: [
      'const members = (block.match(/type:/g) ?? []).length;',
      'const withSession = (block.match(/sessionId:/g) ?? []).length;',
      'expect(members).toBe(withSession);',
    ],
    expectRule: null,
  },
  {
    id: 'R-C 红：标题承诺七条，但断言体没把数量钉住',
    title: '七条通道都要登记',
    body: ["expect(IPC).toHaveProperty('GIT_STATUS');"],
    expectRule: 'R-C',
  },
  {
    id: 'R-C 绿：同样承诺七条，但断言了长度',
    title: '七条通道都要登记',
    body: ['expect(CHANNELS.length).toBe(7);'],
    expectRule: null,
  },
  {
    id: 'R-C 绿：同样承诺七条，但用七元素的内联清单钉住',
    title: '七条通道都要登记',
    body: ["expect(CHANNELS).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);"],
    expectRule: null,
  },
  {
    id: 'R-C 绿：标题承诺三处并自己点名，断言体确有三条独立断言',
    title: 'channels.ts → ipc 注册 → preload 暴露，三处都在',
    body: [
      "expect(channels).toContain(\"TERMINAL_STATUS: 'terminal:status'\");",
      "expect(ipcTerminal).toContain('handle(IPC.TERMINAL_STATUS');",
      "expect(preload).toContain('terminalStatus(');",
    ],
    expectRule: null,
  },
  {
    id: 'R-C 红：标题承诺五条，断言体只有一条（清单变了标题就陈旧）',
    title: '五个设置类面板只在设置中心里被挂载',
    body: ['for (const panel of PANELS) {', '  expect(center).toContain(panel);', '}'],
    expectRule: 'R-C',
  },
  {
    id: 'R-D 红：**R70 的真实案例** —— 标题说"随副本保留"，断言只查模块里有这个字符串',
    title: '许可声明在模块里（ISC 要求随副本保留）',
    body: ["expect(LUCIDE_NOTICE).toContain('ISC License');"],
    expectRule: 'R-D',
  },
  {
    id: 'R-D 绿：同样声称随副本保留，但断言真的落到产物上',
    title: '许可声明在模块里（ISC 要求随副本保留）',
    body: ["expect(fs.readFileSync('dist/main.js', 'utf8')).toContain('ISC License');"],
    expectRule: null,
  },
  {
    id: 'R-D 红：声称扫全仓，但整个文件没有任何跨文件扫描',
    title: '全仓只有 extensions.ts 这一处写钩子配置',
    body: ["expect(ext.split('hooks.save(').length - 1).toBe(1);"],
    expectRule: 'R-D',
  },
  {
    id: 'R-E 红：标题点名 channels.ts，断言体却只查运行时那张表',
    title: 'channels.ts 里的通道都要登记',
    body: ["expect(IPC).toHaveProperty('GIT_STATUS');"],
    expectRule: 'R-E',
  },
  {
    id: 'R-E 绿：同样点名 channels.ts，但断言真的落在它上面',
    title: 'channels.ts 里的通道都要登记',
    body: ["expect(channels.GIT_STATUS).toBe('git:status');"],
    expectRule: null,
  },
];

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

function runChecker(root) {
  let out;
  try {
    out = execFileSync(process.execPath, [checker, '--root', root, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    // 退出码 1 = 有违规（夹具本来就该有违规），不是错误
    if (err.stdout === undefined || err.stdout === '') {
      throw new Error(`判据跑不起来：${err.message}`);
    }
    out = err.stdout;
  }
  return JSON.parse(out.replace(/^\uFEFF/, ''));
}

rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(fixtureRoot, { recursive: true });

const expected = [];
CASES.forEach((c, i) => {
  const file = `case-${String(i + 1).padStart(2, '0')}.test.ts`;
  writeFileSync(join(fixtureRoot, file), fixtureFile(c), 'utf8');
  expected.push({ ...c, file });
});

const result = runChecker(fixtureRoot);
const findings = result.findings ?? [];

let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${text}`);
};

console.log(`夹具：${fixtureRoot}`);
console.log(`判据扫到 ${result.scannedLocks} 条锁，报出 ${findings.length} 处\n`);

for (const c of expected) {
  const hits = findings.filter((f) => f.file === c.file);
  if (c.expectRule) {
    const ok = hits.some((f) => f.rule === c.expectRule);
    say(
      ok,
      `${c.id}\n     期望报出 ${c.expectRule}，实得 ${hits.length ? hits.map((f) => f.rule).join('/') : '（没报）'}`,
    );
  } else {
    const ok = hits.length === 0;
    say(ok, `${c.id}\n     期望不报，实得 ${hits.length ? hits.map((f) => f.rule).join('/') : '（没报）'}`);
  }
}

/** 顺带核一遍：R70 的标题必须被逮住 */
const r70Title = '许可声明在模块里（ISC 要求随副本保留）';
const r70Found = findings.some((f) => f.title === r70Title && f.rule === 'R-D');
say(r70Found, `R70 真实案例当场被逮住（标题：${r70Title}）`);

rmSync(fixtureRoot, { recursive: true, force: true });
console.log(`\n夹具已清：${fixtureRoot}（${existsSync(fixtureRoot) ? '⚠️ 还在' : '已不在'}）`);

if (failed > 0) {
  console.error(`\n❌ 自检失败：${failed} 条规则没按预期红/绿。判据本身不可信 ⇒ 不要用它当门禁。`);
  process.exit(1);
}
console.log('\n✅ 自检通过：每条规则都能红，且绿例不被误报。');
process.exit(0);
