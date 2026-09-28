/**
 * 依赖许可证合规检查（W12 / 开源合规）
 *
 * 用法：npm run license:check
 *
 * 规则（对齐用户要求「逐一核实、区分许可证条款」）：
 * 1. **硬拒绝**：GPL / AGPL / SSPL 等**强 copyleft** —— 这类许可若进入本项目，
 *    会要求整个作品以同等许可开放，与 MIT 定位冲突。**发现即非零退出**。
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

/** 硬拒绝：强 copyleft / 使用受限 */
const HARD_DENY = [/^GPL/i, /^AGPL/i, /^SSPL/i, /^CC-BY-NC/i, /^(UNLICENSED|UNLICEN[CS]ED)$/i];
/** 需声明：弱 copyleft / 需署名（允许使用，但有义务） */
const NOTICE = [/^LGPL/i, /^MPL/i, /^CC-BY/i];

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
      lic = String(j.license || '(未声明)').trim();
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

// ---- 生成清单文档（便于第三方审阅我们分发了什么） ----
const byLic = {};
for (const v of seen.values()) (byLic[v.lic] = byLic[v.lic] || []).push(`${v.name}@${v.ver}`);
const licOrder = Object.keys(byLic).sort((a, b) => byLic[b].length - byLic[a].length);

let doc = `# 依赖许可证清单（自动生成）\n\n`;
doc += `> 由 \`npm run license:check\` 生成。**不要手改**——重新运行即可更新。\n`;
doc += `> 规则：强 copyleft（GPL/AGPL/SSPL）= 硬拒绝；LGPL/MPL/CC-BY = 需声明义务；其余按各自许可。\n\n`;
doc += `**汇总**：共 ${seen.size} 个去重依赖。\n\n`;
for (const lic of licOrder) {
  doc += `## ${lic}（${byLic[lic].length} 个）\n\n`;
  doc += byLic[lic].map((n) => `- ${n}`).join('\n');
  doc += `\n\n`;
}
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(OUT_DOC, doc, 'utf8');
console.log(`\n已生成 ${OUT_DOC.replace(String(ROOT), '')}`);

if (failed) {
  console.error('\nlicense:check 结论：存在硬拒绝项，必须处理');
  process.exit(1);
}
console.log('\nlicense:check 结论：通过');
