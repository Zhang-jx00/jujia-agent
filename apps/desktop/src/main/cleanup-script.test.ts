import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * 清理脚本的**行为锁**（R48 · 排查16 · T35 + T36）。
 *
 * 为什么这两条要有锁：T35 与 T36 **早就修好了**（T35 在 R12、T36 在 R23），
 * 但**一条测试都没有**——仓库里没有任何一个测试跑过 `scripts/cleanup.py`。
 * 于是"修好了"这件事只活在**两行代码**里：
 *   · T35：`sys.stdout.reconfigure(errors="replace")`（`cleanup.py:33-36`）
 *   · T36：`SKIP_DIR_NAMES` 里那一个 `".evidence"`（`cleanup.py:92`）
 * 任何人动这两行（重构、清理、格式化）都不会有测试变红 ⇒ **锁等于没有**。
 *
 * 为什么必须是**行为锁**而不是扫源码：
 * `apps/desktop/src/main/test-policy.test.ts` 对 `cleanup.py` 的断言是
 * `expect(cleanupPy).toContain('".tmp"')` —— 那种断言只能证"字面量在文件里"，
 * 证不了"跑起来是不是这个行为"。本文件**真的把脚本跑起来**，看它到底做了什么。
 *
 * 为什么要**复制**一份再跑：`cleanup.py` 的 `PROJECT` 是它自己所在 `scripts/` 的上一级，
 * 直接跑仓库里那份就会对着真仓库动手（搬 `.tmp`、进 `.trash`）。
 * 复制到一次性目录里，`PROJECT` 就落在那个一次性目录，**所有副作用都被关在笼子里**。
 *
 * 为什么强制 GBK：中文 Windows 的控制台默认 GBK，✓ 编不出来会当场崩栈（T35 的机制）。
 * 这里用 `PYTHONIOENCODING=gbk` 把那条路**钉死**成每次都跑，而不是"看运气"。
 */

const execFileAsync = promisify(execFile);

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CLEANUP_PY = join(REPO, 'scripts', 'cleanup.py');

/** 解码：脚本在 GBK 控制台上吐的是 GBK 字节，按 UTF-8 解会变成乱码。 */
const decode = (buf: Buffer | string): string =>
  typeof buf === 'string' ? buf : new TextDecoder('gbk').decode(buf);

/**
 * 找一个能用的 python。
 *
 * 为什么不许"找不到就跳过"：一条**永远跳过**的锁比没有锁更坏 ——
 * 它让人以为"有人盯着"，实际上一双眼睛都没有（本仓 T13 因此禁掉了 `passWithNoTests`）。
 * 找不到就**当场失败**，并把怎么修写清楚。
 */
async function findPython(): Promise<{ cmd: string; prefix: string[] }> {
  const candidates: { cmd: string; prefix: string[] }[] = [];
  if (process.env['JUJIA_PYTHON']) candidates.push({ cmd: process.env['JUJIA_PYTHON'], prefix: [] });
  candidates.push({ cmd: 'python', prefix: [] }, { cmd: 'py', prefix: ['-3'] }, { cmd: 'python3', prefix: [] });
  for (const c of candidates) {
    try {
      await execFileAsync(c.cmd, [...c.prefix, '-c', 'import sys; print(sys.version_info[0])'], { timeout: 20_000 });
      return c;
    } catch {
      // 试下一个
    }
  }
  throw new Error(
    '找不到可用的 python：清理脚本是 python 实现的，这条行为锁需要它。' +
      '装一个 python，或用 JUJIA_PYTHON 环境变量指到解释器。',
  );
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 跑一次清理脚本（**不吞错误**：崩了也要把退出码与 stderr 拿回来断言）。 */
async function runCleanup(
  py: { cmd: string; prefix: string[] },
  projDir: string,
  args: string[],
): Promise<RunResult> {
  const options = {
    cwd: projDir,
    env: { ...process.env, PYTHONIOENCODING: 'gbk' },
    encoding: 'buffer' as const,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  };
  try {
    const r = await execFileAsync(py.cmd, [...py.prefix, join(projDir, 'scripts', 'cleanup.py'), ...args], options);
    return { code: 0, stdout: decode(r.stdout), stderr: decode(r.stderr) };
  } catch (e) {
    const err = e as { code?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: typeof err.code === 'number' ? err.code : -1,
      stdout: decode(err.stdout ?? Buffer.alloc(0)),
      stderr: decode(err.stderr ?? Buffer.alloc(0)),
    };
  }
}

/**
 * 造一个一次性"项目"：`<repo>/.tmp/cleanup-lock-XXXX/proj/`。
 *
 * 两层嵌套是刻意的：`cleanup.py` 会去 `PROJECT.parent` 找"登记在案的已知残骸"
 * （`pack-probe-projone`）。多一层 ⇒ 它找的是**一次性目录**里的同名路径，
 * 绝不会是工作区根那只真残骸 ⇒ 这条测试**碰不到**真东西。
 */
async function makeProject(): Promise<{ base: string; proj: string }> {
  const base = await mkdtemp(join(REPO, '.tmp', 'cleanup-lock-'));
  const proj = join(base, 'proj');
  await mkdir(join(proj, 'scripts'), { recursive: true });
  await writeFile(join(proj, 'scripts', 'cleanup.py'), await readFile(CLEANUP_PY));
  return { base, proj };
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

describe('清理脚本的行为锁（T35 GBK 控制台 + T36 取证目录）', () => {
  it('中文 Windows 的 GBK 控制台上不崩，且"项目已干净"这句话真的打出来了', async () => {
    const py = await findPython();
    const { base, proj } = await makeProject();
    try {
      // 空工程 ⇒ 走**最常见**的那条成功路径（"项目已干净"）
      const r = await runCleanup(py, proj, []);
      expect(r.code, `GBK 下退出了 ${r.code}；stderr：${r.stderr}`).toBe(0);
      expect(r.stderr).not.toContain('UnicodeEncodeError');
      expect(r.stderr).not.toContain('Traceback');
      // 关键：不是"崩了所以没输出"，也不是"输出被 try/except 吞了" —— 那句话必须真的在
      expect(r.stdout).toContain('项目已干净');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('--apply 之后，取证目录里的东西一只都不少（连名字像临时产物的也不少）', async () => {
    const py = await findPython();
    const { base, proj } = await makeProject();
    try {
      const ev = join(proj, '.evidence', 'r48-lock');
      await mkdir(ev, { recursive: true });
      await writeFile(join(ev, 'keep.log'), 'red-green evidence', 'utf8');
      // 这两只**名字命中临时模式**（`*.bak` / `*.tmp`）—— 它们才是承重的那一对：
      // 只放 `keep.log` 的话，把 `.evidence` 从豁免名单里拿掉也照样不搬家 ⇒ 那是**假变异**
      await writeFile(join(ev, 'evidence.bak'), 'backup-named evidence', 'utf8');
      await writeFile(join(ev, 'result.tmp'), 'tmp-named evidence', 'utf8');
      // 项目根的一只临时产物：它**必须**被搬走，否则这把锁就成"什么都不敢动"的假绿
      await writeFile(join(proj, 'scratch.tmp'), 'root temp artifact', 'utf8');

      const r = await runCleanup(py, proj, ['--apply']);
      expect(r.code, `退出码 ${r.code}；stderr：${r.stderr}`).toBe(0);

      // 证据一只不少，内容一字未改
      expect(await readFile(join(ev, 'keep.log'), 'utf8')).toBe('red-green evidence');
      expect(await readFile(join(ev, 'evidence.bak'), 'utf8')).toBe('backup-named evidence');
      expect(await readFile(join(ev, 'result.tmp'), 'utf8')).toBe('tmp-named evidence');

      // 临时产物确实进了回收站（不是凭空消失，也不是留在原地）
      expect(await exists(join(proj, 'scratch.tmp'))).toBe(false);
      const trash = join(proj, '.trash');
      const batches = await readdir(trash);
      expect(batches.length).toBe(1);
      expect(await readFile(join(trash, batches[0] as string, 'scratch.tmp'), 'utf8')).toBe('root temp artifact');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
