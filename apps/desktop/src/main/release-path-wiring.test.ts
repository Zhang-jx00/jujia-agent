import { describe, expect, it, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * **发布前路径（build → dist → verify:pack）的接线锁**（R73 · 排查42 收口 · 原在制品线编号 R78）。
 *
 * ## 它守什么
 *
 * 「发出去之后」那一格要有一条**可复跑**的路径，否则每次发版都要靠人把三段命令拼起来，
 * 而拼起来的中间态正是历史上出事的地方：
 * · 门禁验的那份产物 ≠ 要发的那份（`verify:pack` 自己打包、验完删掉，`dist` 写固定目录）；
 * · 固定目录会被上一轮残留的句柄挡路（R35/R37 连踩三轮）。
 *
 * ## 为什么判据是"跑一次看它打算干什么"，而不是"断言文件里有某句话"
 *
 * 本仓吃过一次亏：**断言"文件里出现过某个字符串"** 锁的是自己想象中的实现
 * （本文件第一版就栽在这上面：`'electron-vite build'` 这个字面量在**计划表**里比**调用点**更早出现，
 *   顺序断言因此完全失效）。⇒ 下面三条判据都改成**真跑**：
 *   · `--dry-run` 真的跑一遍，parse 它报出来的计划；
 *   · 联接预检真的造一个**目录联接**去撞它（不是读源码找字符串）。
 */
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const MODULE_URL = pathToFileURL(join(repoRoot, 'scripts/release-prep.mjs')).href;

interface Plan {
  runId: string;
  outDir: string;
  outDirAbs: string;
  build: string;
  pack: string;
  verify: string;
}

/** 跑一段 node 代码，返回 stdout（失败就把 stderr 抛出来，别让人对着空输出猜） */
function runNode(code: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: repoRoot });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`子进程退出码 ${String(code)}：${err}`));
        return;
      }
      done(out);
    });
  });
}

const created: string[] = [];
afterEach(async () => {
  for (const dir of created.splice(0, created.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('发布前路径（dist → verify:pack 一条命令，R73）', () => {
  it('npm run release:prep 存在，且它指向的脚本真的在', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['release:prep']).toBe('node scripts/release-prep.mjs');
    expect(existsSync(join(repoRoot, 'scripts/release-prep.mjs'))).toBe(true);
  });

  it('--dry-run 报出的产物目录带运行 id（不与任何一轮共用目录），且计划里包含 verify:pack', () => {
    const r = spawnSyncNode();
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout) as Plan;

    // 产物目录：**带运行 id** ⇒ 不是那个固定目录
    expect(plan.outDir).not.toBe('release');
    expect(plan.outDir.startsWith('rel-')).toBe(true);
    expect(plan.outDir).toContain(plan.runId);

    // 门禁在**同一条路径**上
    expect(plan.verify).toContain('verify-pack.mjs');
    expect(plan.build).toContain('electron-vite');
    expect(plan.pack).toContain('electron-builder');
  });

  it('预检拦得住"node_modules 是目录联接"这一种（原线实测：产物会缺依赖、打包版起不来）', async () => {
    const root = await mkdtemp(join(repoRoot, '.tmp', 'release-prep-'));
    created.push(root);
    const real = join(root, 'real-nm');
    await mkdir(real, { recursive: true });
    const linked = join(root, 'node_modules');
    // **真的目录联接**（Windows 上 junction 不需要管理员权限）
    await symlink(real, linked, 'junction');

    const out = await runNode(
      `import { checkNodeModulesIsRealDir } from ${JSON.stringify(MODULE_URL)};` +
        `process.stdout.write(JSON.stringify({` +
        ` linked: checkNodeModulesIsRealDir(${JSON.stringify(linked)}),` +
        ` real: checkNodeModulesIsRealDir(${JSON.stringify(real)}) }));`,
    );
    const r = JSON.parse(out) as { linked: string | null; real: string | null };
    // 联接 ⇒ 必须给出**说人话的**原因（而不是"跳过"或直接放行）
    expect(r.linked).toContain('联接');
    expect(r.linked).toContain('node-pty');
    // 真目录 ⇒ 放行
    expect(r.real).toBeNull();
  });
});

/** 跑一次 --dry-run（同步版，便于断言退出码） */
function spawnSyncNode(): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts/release-prep.mjs'), '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}
