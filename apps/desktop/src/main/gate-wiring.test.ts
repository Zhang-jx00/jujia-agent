import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideGate, rulesAreUntrusted } from '@jujia/agent-core';
import { createFilePermissionRulesStore } from './permission-rules-store';

/**
 * T74 的接线锁：**每一个生产代码里的 `decideGate(` 调用点都必须把「规则表这次读不出来」传下去**。
 *
 * 为什么需要这道锁（不是"保险起见"，是这条修复的成败取决于它）：
 * T74 的判据在 `decideGate` 里（规则表不可信 ⇒ 非只读一律硬 ask），
 * 而 `decideGate` 的上下文是**各调用点自己拼**的 —— 拼错一处、漏传一处，
 * 那个入口就**静默回到"按空表放行"** ⇒ 而门禁全绿（其他入口都传了）。
 * ⇒ 光看"有一处传了"不够，**每一处都要传**。
 *
 * 形状：现扫全仓**非测试**的 .ts 文件 ⇒ 凡出现 `decideGate(` 的，
 * 其调用点往下 12 行内必须出现 `rulesUntrusted` ⇒ 漏一处即红。
 * **不写死文件清单**（新加一个调用点时，锁会自动把它算进来）。
 *
 * 为什么排除测试文件：测试里直接调 `decideGate(ctx({...}))` 是**判定本身的单元测试**，
 * 它们不经过任何"拼上下文"的那一层 ⇒ 不该被要求传这个标志。
 */

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', 'out', 'dist', 'release', 'coverage']);

function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTs(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('T74 接线锁：每个 decideGate 调用点都要传「规则表这次读不出来」', () => {
  const files = [
    ...collectTs(join(repoRoot, 'apps')),
    ...collectTs(join(repoRoot, 'packages')),
  ];

  /** 剥掉注释（**保留行数**）—— 否则注释里提到 `decideGate(` 也会被当成调用点 */
  const stripComments = (text: string): string[] => {
    const out: string[] = [];
    let inBlock = false;
    for (const raw of text.split('\n')) {
      let line = raw;
      if (inBlock) {
        const end = line.indexOf('*/');
        if (end === -1) {
          out.push('');
          continue;
        }
        line = line.slice(end + 2);
        inBlock = false;
      }
      // 去掉行内块注释与行注释（字符串里的 // 不管它 —— 判定锚点不在字符串里）
      line = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
      if (line.includes('/*')) {
        inBlock = true;
        line = line.slice(0, line.indexOf('/*'));
      }
      out.push(line);
    }
    return out;
  };

  it('现扫到全仓非测试的 .ts 文件（防失焦：一条都没扫到 ⇒ 定位器失效）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('凡出现 decideGate( 的生产调用点，其上下文里必须有 rulesUntrusted', () => {
    const missing: string[] = [];
    let callSites = 0;
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      code.forEach((line, i) => {
        if (!line.includes('decideGate(')) return;
        // **函数定义本身不是调用点**（`export function decideGate(...)`）⇒ 跳过
        if (line.includes('function decideGate(')) return;
        callSites += 1;
        // 窗口取整段 ctx 对象（判档调用的参数列表比 12 行长）
        const window = code.slice(i, i + 20).join('\n');
        if (!window.includes('rulesUntrusted')) {
          missing.push(`${relative(repoRoot, file).split('\\').join('/')}:${String(i + 1)}`);
        }
      });
    }
    // 防失焦：调用点一个都没扫到 ⇒ 锁在跑空
    expect(callSites).toBeGreaterThanOrEqual(4);
    expect(missing).toEqual([]);
  });

  it('判定核心里那条分支还在（不在 ⇒ 这条修复根本没生效）', () => {
    const policy = readFileSync(join(repoRoot, 'packages/agent-core/src/permissions/policy.ts'), 'utf8');
    expect(policy).toContain('ctx.rulesUntrusted === true');
    expect(policy).toContain('权限规则表这次读不出来');
  });

  it('降级的口径取自 agent-core 的同一个函数（不各写各的）', () => {
    const context = readFileSync(join(repoRoot, 'apps/desktop/src/main/ipc/context.ts'), 'utf8');
    expect(context).toContain('rulesAreUntrusted(rulesHealth)');
    expect(context).not.toContain('rulesUntrusted: rulesHealth.recovered');
  });
});

/**
 * T74 的**真缝**：真文件实现（不是内存替身）放一只坏掉的规则文件
 * ⇒ health 报"读坏了" ⇒ 降级口径 ⇒ **判定侧硬 ask**（而不是按空表放行）。
 *
 * 为什么这条值得单独写：前两条锁盯的是"接线有没有漏"，
 * 而这条盯的是**整条链真的通** —— 坏文件 → `recovered: true` → 硬 ask。
 * 少了它，判定单测与接线锁都绿，也可能是"两段各自对、中间没接上"。
 */
describe('T74 的真缝：坏掉的规则文件 ⇒ 硬 ask（不是按空表放行）', () => {
  const roots: string[] = [];
  const prevRoot = process.env['JUJIA_DATA_BASE_DIR'];

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env['JUJIA_DATA_BASE_DIR'];
    else process.env['JUJIA_DATA_BASE_DIR'] = prevRoot;
    for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
  });

  it('坏 JSON 的规则文件 ⇒ 降级 ⇒ 非只读一律硬 ask', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp', 't74-'));
    roots.push(root);
    process.env['JUJIA_DATA_BASE_DIR'] = root;
    await writeFile(join(root, 'permission-rules.json'), '{ 这不是 JSON', 'utf8');

    const store = createFilePermissionRulesStore();
    const health = await store.health();
    expect(health.recovered).toBe(true);

    const d = decideGate({
      mode: 'default',
      toolName: 'write_file',
      kind: 'write',
      args: { path: 'a.md' },
      rulesUntrusted: rulesAreUntrusted(health),
    });
    if (d.action !== 'ask') throw new Error(`期望硬 ask，实际是 ${d.action}`);
    expect(d.bypassable).toBe(false);
    expect(d.reason).toContain('规则表');
  });

  it('**从来没有规则文件**（正常首装）⇒ 不是降级 ⇒ 行为与从前一字不差', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp', 't74-'));
    roots.push(root);
    process.env['JUJIA_DATA_BASE_DIR'] = root;

    const store = createFilePermissionRulesStore();
    const health = await store.health();
    expect(health).toEqual({ source: 'default', recovered: false });
    expect(rulesAreUntrusted(health)).toBe(false);

    // 正常状态下的写操作仍是**软 ask**（可被「本次会话总是允许」压掉）—— 与从前一致
    const d = decideGate({
      mode: 'default',
      toolName: 'write_file',
      kind: 'write',
      args: { path: 'a.md' },
      rulesUntrusted: rulesAreUntrusted(health),
    });
    if (d.action !== 'ask') throw new Error(`期望软 ask，实际是 ${d.action}`);
    expect(d.bypassable).toBe(true);
  });
});
