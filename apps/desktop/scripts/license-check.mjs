/**
 * 依赖许可证合规检查（W12 / 开源合规）
 *
 * 用法：npm run license:check
 *
 * 规则（对齐用户要求「逐一核实、区分许可证条款」）：
 * 1. **硬拒绝**：GPL / AGPL / SSPL 等**强 copyleft** —— 这类许可若进入本项目，
 *    会要求整个作品以同等许可开放，与 MIT 定位冲突。**发现即非零退出**。
 *    匹配**不锚定行首**：SPDX 表达式里这类字样常出现在中间。
 * 2. **需声明**：LGPL / MPL-2.0 / CC-BY-4.0 等**弱 copyleft 或需署名**许可 ——
 *    允许使用，但必须保留许可声明、提供源码获取方式（LGPL）或给出署名（CC-BY）。
 *    发现时打印处置要求；若随应用分发，必须出现在 THIRD_PARTY_NOTICES.md。
 * 3. **未声明**：没有 license 字段的包 —— 要求补齐或人工确认。
 * 4. 宽松许可（MIT / ISC / Apache-2.0 / BSD / 0BSD / BlueOak / WTFPL / Python-2.0）：放行。
 *
 * 退出码：0 = 通过；1 = 存在硬拒绝项。
 */
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = decodeURIComponent(new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const NODE_MODULES = join(ROOT, 'node_modules');
const OUT_DOC = join(ROOT, 'docs', 'DEPENDENCY-LICENSES.md');

/** 硬拒绝：强 copyleft / 使用受限。不锚定行首 —— SPDX 表达式里 copyleft 常在中间
 *  （`Apache-2.0 AND LGPL-3.0-or-later`、`Apache-2.0 AND LGPL-3.0-or-later AND MIT`），
 *  锚定行首会把它们当宽松许可放过去。`(?<![LA])GPL` 用来避开 LGPL / AGPL 的子串误伤。 */
const HARD_DENY = [
  /(?<![LA])GPL/i,
  /\bAGPL\b/i,
  /\bSSPL\b/i,
  /\bCC-BY-NC\b/i,
  /\bUNLICENSED\b|\bUNLICENCED\b/i,
];
/** 需声明：弱 copyleft / 需署名（允许使用，但有义务） */
const NOTICE = [/\bLGPL\b/i, /\bMPL\b/i, /\bCC-BY\b/i];

function licenseRisk(lic) {
  const s = String(lic || '').trim();
  if (s === '' || s === 'UNKNOWN' || s === '(未声明)') return 'unknown';
  if (HARD_DENY.some((re) => re.test(s))) return 'deny';
  if (NOTICE.some((re) => re.test(s))) return 'notice';
  return 'ok';
}

function scan(dir, depth, seen) {
  if (depth > 6 || !existsSync(dir)) return;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (name.startsWith('@')) {
      scan(full, depth + 1, seen);
      continue;
    }
    const pj = join(full, 'package.json');
    let lic = '(未声明)';
    let ver = '';
    // 作用域包（@scope/name）的**目录名只是尾巴**（`@testing-library/react` 的目录叫 `react`）：
    // 用目录名记账会把第三方清单写成错名字，还会与同名包互相吞掉。
    let realName = name;
    try {
      const j = JSON.parse(readFileSync(pj, 'utf8'));
      // 老包会把 license 写成对象（`{type:'GPL-2.0',url:...}`）。`String(对象)` 得到
      // `[object Object]` —— 既不匹配任何规则、又不是"未声明"，会被当成宽松许可**静默放行**。
      // 所以非字符串的一律原样序列化出来：真写着 GPL 就会被上面的规则拦住，写不清的就进"未声明"待人工。
      const raw = j.license;
      lic =
        typeof raw === 'string'
          ? raw.trim()
          : raw == null
            ? '(未声明)'
            : JSON.stringify(raw);
      ver = j.version || '';
      if (typeof j.name === 'string' && j.name !== '') realName = j.name;
    } catch {
      /* 读取失败按未声明处理 */
    }
    const key = `${realName}@${ver}`;
    if (!seen.has(key)) seen.set(key, { name: realName, ver, lic, risk: licenseRisk(lic) });
    scan(join(full, 'node_modules'), depth + 1, seen);
  }
}

const seen = new Map();
scan(NODE_MODULES, 0, seen);

const groups = { deny: [], notice: [], unknown: [], ok: {} };
for (const [, v] of seen) {
  if (v.risk === 'deny') groups.deny.push(v);
  else if (v.risk === 'notice') groups.notice.push(v);
  else if (v.risk === 'unknown') groups.unknown.push(v);
  else (groups.ok[v.lic] = groups.ok[v.lic] || []).push(`${v.name}@${v.ver}`);
}

console.log(`依赖总数（去重）：${seen.size}`);
console.log(`  宽松许可：${Object.values(groups.ok).reduce((a, b) => a + b.length, 0)} 个`);
console.log(`  需声明（LGPL/MPL/CC-BY）：${groups.notice.length} 个`);
console.log(`  未声明：${groups.unknown.length} 个`);
console.log(`  硬拒绝（强 copyleft）：${groups.deny.length} 个`);

let failed = false;
if (groups.deny.length > 0) {
  failed = true;
  console.error('\n✗ 发现强 copyleft 许可（与 MIT 定位冲突，必须移除或换替代）：');
  for (const v of groups.deny) console.error(`   ${v.name}@${v.ver} → ${v.lic}`);
}
if (groups.unknown.length > 0) {
  console.warn('\n⚠ 未声明许可的包（需人工确认）：');
  for (const v of groups.unknown) console.warn(`   ${v.name}@${v.ver}`);
}

// ---- 区分"随安装包分发"与"仅构建期"（外部审查 T21）----
//
// 为什么要分：这份清单的开头写着"审阅我们分发了什么"，可它扫的是整个 node_modules ——
// eslint / typescript / jsdom 这些**只在我们机器上跑**的包被和运行时依赖混进同一张表，
// 读的人会以为 Electron 应用里带着它们。
//
// 口径来源：**`package-lock.json` 里每条的 `dev` 标记**。这是 npm 装包时自己算出来的结论
// （"只从 devDependencies 可达"），端依赖（peer）、可选平台二进制（optional）、嵌套副本都算过了。
// 两条弯路都实测踩过，写下来免得下次再走：
//   ① 从盘上按各包 `dependencies` 自己走一遍闭包 —— `@testing-library/dom` 是 peer、`postject`
//      是 optional+peer，沿边走不到，结果 **18 个纯构建期的包被错判成"随包分发"**；
//   ② 改用 `npm ls --all --omit=dev` —— 它把只被 dev 包引用的 `@img/sharp-wasm32` / `@emnapi/runtime`
//      / `tslib` 也吐进 prod 树，和它自己锁里的 `dev:true` 互相打脸。
// 结论：取锁文件的 `dev` 标记（同一份数据里自洽的那一份）。
//
// 保守优先：盘上扫到、锁文件里却没有对应条目的（workspace 软链就是这种），一律留在 §A。
// 多列不是错，漏列才是。
const LOCK = join(ROOT, 'package-lock.json');
const distributedKeys = new Set();
const lockedKeys = new Set();
let lockRead = false;
try {
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  lockRead = true;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const marker = 'node_modules/';
    const at = key.lastIndexOf(marker);
    if (at < 0) continue; // 根项目与各 workspace 自身（`apps/desktop`）不是第三方包
    const name = key.slice(at + marker.length);
    const ver = entry.version;
    if (name === '' || ver === undefined) continue;
    const k = `${name}@${ver}`;
    lockedKeys.add(k);
    if (!entry.dev) distributedKeys.add(k);
  }
} catch {
  console.warn('\n⚠ 读不到 package-lock.json：无法区分分发/构建期，全部按"分发"列（保守）');
}

// **唯一一条覆盖**：`electron` 在 package.json 里写的是 devDependencies（npm 的惯例：装的是"工具"），
// 而 electron-builder 会把预编译好的 Electron 二进制**复制进安装目录随包分发**。
// 按锁文件的 dev 标记，它会被分到"仅构建期" —— 那正是这份清单要避免的头号误导，所以显式拉回 §A。
// 只拉它自己，不拉它的依赖闭包：`@electron/get` 那串下载器只在安装期跑，不进取物包。
// 除它以外不再加覆盖：多一条覆盖就少一分口径的可信度。
const FORCE_A = new Map([['electron', '二进制随包分发（npm 惯例把它记在 devDependencies）']]);

const isDistributed = (v) => {
  const k = `${v.name}@${v.ver}`;
  if (distributedKeys.has(k) || FORCE_A.has(v.name)) return true;
  return !lockedKeys.has(k);
};

const sectionOf = (list) => {
  const byLic = {};
  for (const v of list) (byLic[v.lic] = byLic[v.lic] || []).push(`${v.name}@${v.ver}`);
  const order = Object.keys(byLic).sort((a, b) => byLic[b].length - byLic[a].length);
  return order
    .map((lic) => `### ${lic}（${byLic[lic].length} 个）\n\n${byLic[lic].map((n) => `- ${n}`).join('\n')}\n`)
    .join('\n');
};

const prodList = [...seen.values()].filter(isDistributed);
const devList = [...seen.values()].filter((v) => !isDistributed(v));

let doc = `# 依赖许可证清单（自动生成）\n\n`;
doc += `> 由 \`npm run license:check\` 生成。**不要手改**——重新运行即可更新。\n`;
doc += `> 规则：强 copyleft（GPL/AGPL/SSPL）= 硬拒绝；LGPL/MPL/CC-BY = 需声明义务；其余按各自许可。\n`;
doc += `> 归类看 SPDX 表达式的**任意位置**（\`Apache-2.0 AND LGPL-3.0-or-later\` 也算需声明），不只看开头。\n\n`;
doc += `> **本表覆盖整个 \`node_modules\`（共 ${seen.size} 个去重依赖），分两节**：\n`;
doc += `> **§A 随安装包分发**（${prodList.length} 个 —— copyleft 的关注点全在这一节）；\n`;
doc += `> **§B 仅构建期 · 不随包分发**（${devList.length} 个 —— 按开源合规惯例保留声明即可，不删条目）。\n`;
doc += lockRead
  ? `> 划分口径：\`package-lock.json\` 每条的 \`dev\` 标记（npm 安装时算出来的可达性，peer / optional 都算过）。\n` +
    `> 唯一一条手动覆盖：${[...FORCE_A.keys()].map((n) => `\`${n}\``).join('、')} —— 见脚本注释。判不准的条目一律留在 §A。\n\n`
  : `> ⚠ 本次生成**读不到 \`package-lock.json\`**，无法区分两类，全部落在 §A（保守）。\n\n`;
doc += `## §A 随安装包分发（${prodList.length} 个）\n\n`;
doc += `${sectionOf(prodList)}\n`;
doc += `## §B 仅构建期 · 不随包分发（${devList.length} 个）\n\n`;
doc += `${sectionOf(devList)}\n`;
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(OUT_DOC, doc, 'utf8');
console.log(`\n已生成 ${OUT_DOC.replace(String(ROOT), '')}`);
console.log(`  §A 随安装包分发：${prodList.length} 个`);
console.log(`  §B 仅构建期：${devList.length} 个`);
if (prodList.length + devList.length !== seen.size) {
  console.error(`✗ 分节条目数与总数不符（${prodList.length}+${devList.length} ≠ ${seen.size}）`);
  process.exit(1);
}

if (failed) {
  console.error('\nlicense:check 结论：存在硬拒绝项，必须处理');
  process.exit(1);
}
console.log('\nlicense:check 结论：通过');
