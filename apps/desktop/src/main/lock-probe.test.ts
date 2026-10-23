import { describe, expect, it, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * `verify-pack` 的**锁探针**（T69③）：两条分支都要在门禁内部被真跑一次。
 *
 * 问题原文（T69③ 登记）：探针有两条分支 ——「改名**改不动** ⇒ 句柄还在别人手里」与
 * 「改名**改得动** ⇒ 句柄这一刻松了，按真·瞬时锁处理」—— 而**"改得动"那一支至今没在门禁内部撞过**
 * （只手工试过：一次 2ms、仓库外那两次 0.6–0.8s，**都不是门禁自己跑的**）⇒
 * 那条分支等于**没有测试**。
 *
 * 本轮把它抽成独立模块（`apps/desktop/scripts/lock-probe.mjs`）并补两条用例：
 * ① **句柄真的在别人手里** ⇒ 用 `FileShare.None` 造一个**真·独占句柄**
 *    （Windows 上 Node 开不出独占句柄 —— `fs.openSync` 默认带 `FILE_SHARE_DELETE` ⇒ 改不了名；
 *    ⇒ 借 .NET 的 `FileShare.None` 造 ⇒ rename 必然 `EBUSY`）⇒ 探针必须说"句柄还在"；
 * ② **没有持有者** ⇒ 探针必须说"改得动"。
 *
 * 口径：探针**以子进程方式**跑（与门禁里真实的用法同形）⇒ 也不需要给 .mjs 写类型声明
 * （本仓 tsconfig 没开 `allowJs`，也没有 .ts 引 .mjs 的先例）。
 */
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const MODULE_URL = pathToFileURL(join(repoRoot, 'apps/desktop/scripts/lock-probe.mjs')).href;

/** 跑一次探针（子进程） */
function runProbe(target: string): Promise<{ held: boolean; text: string }> {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { probeFileLock } from ${JSON.stringify(MODULE_URL)};` +
          `process.stdout.write(JSON.stringify(probeFileLock(${JSON.stringify(target)})));`,
      ],
      { cwd: repoRoot },
    );
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
        fail(new Error(`探针子进程退出码 ${String(code)}：${err}`));
        return;
      }
      try {
        done(JSON.parse(out) as { held: boolean; text: string });
      } catch {
        fail(new Error(`探针输出不是 JSON：${out}`));
      }
    });
  });
}

/** 起一个持有**真·独占句柄**的子进程（.NET 的 `FileShare.None`） */
function holdExclusive(file: string): Promise<{ child: ChildProcess; release: () => void }> {
  return new Promise((done, fail) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$f=[System.IO.File]::Open('${file}','Open','Read','None');` +
          `[Console]::Out.Write('held');[Console]::Out.Flush();Start-Sleep -Seconds 30`,
      ],
      { cwd: repoRoot },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`独占句柄的持有者没就绪（输出：${out} / 错误：${err}）`));
    }, 20000);
    child.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('held')) {
        clearTimeout(timer);
        done({ child, release: () => child.kill() });
      }
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      fail(e);
    });
  });
}

/** 杀掉持有者并**等它真的退出**（句柄是随进程退出才释放的 ⇒ 不等就会在收尾时撞 EBUSY） */
const killAndWait = (child: ChildProcess): Promise<void> =>
  new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }
    const timer = setTimeout(() => done(), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    child.kill();
  });

describe('verify-pack 的锁探针：两条分支都要在门禁内部被真跑一次（T69③）', () => {
  const roots: string[] = [];
  const holders: ChildProcess[] = [];

  afterEach(async () => {
    for (const h of holders.splice(0)) await killAndWait(h);
    for (const r of roots.splice(0)) {
      // 句柄释放有毫秒级延迟 ⇒ 删目录要能重试几次（否则红在收尾，不是红在断言）
      for (let i = 0; i < 10; i += 1) {
        try {
          await rm(r, { recursive: true, force: true });
          break;
        } catch (e) {
          if (i === 9) throw e;
          await new Promise((res) => setTimeout(res, 200));
        }
      }
    }
  });

  const makeTarget = async (): Promise<string> => {
    const root = await mkdtemp(join(process.cwd(), '.tmp', 'lock-probe-'));
    roots.push(root);
    const file = join(root, 'default_app.asar');
    await writeFile(file, 'x', 'utf8');
    return file;
  };

  it('分支一：句柄真在别人手里（FileShare.None 的独占句柄）⇒ 探针说"改不动"', async () => {
    const file = await makeTarget();
    const { child, release } = await holdExclusive(file);
    holders.push(child);
    try {
      const r = await runProbe(file);
      expect(r.held).toBe(true);
      expect(r.text).toContain('改不动');
      // 内容一个字节没动（探针只改名，不写内容）
      expect(r.text).not.toContain('还原失败');
    } finally {
      release();
    }
  });

  it('分支二：没有持有者 ⇒ 探针说"改得动"，且文件原样还在', async () => {
    const file = await makeTarget();
    const r = await runProbe(file);
    expect(r.held).toBe(false);
    expect(r.text).toContain('改得动');
  });

  it('分支三：文件不在 ⇒ 不是"这一把锁"（不得当成"句柄还在"）', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp', 'lock-probe-'));
    roots.push(root);
    const r = await runProbe(join(root, '没有这个文件.asar'));
    expect(r.held).toBe(false);
    expect(r.text).toContain('没有那只解包用的 asar');
  });
});
