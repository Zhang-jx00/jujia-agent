import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commit,
  getDiffPatch,
  DIFF_HIGHLIGHTS_PER_FILE,
  getDiffSummary,
  getRecentCommits,
  getStatus,
  isGitRepo,
  isNoisePath,
  stagePaths,
  unstagePaths,
} from './git';

/**
 * W9a 验收重点：
 * - 只读查询在真实 git 仓库上正确工作；
 * - **diff 摘录不返回全文**（关键代码块摘录），并如实标注截断；
 * - 噪音文件（lockfile/构建产物）被识别出来；
 * - 写操作（stage/commit）可用，且参数走数组不拼 shell（用含空格/中文的路径验证）；
 * - 非仓库/无 git 时给出可读错误而不是抛异常。
 */

// 本文件每个用例都会真实 spawn 多个 git 子进程（beforeEach 里 6 次）。
// 实测本机单次 git 进程启动约 0.7–1s（Windows + 安全软件扫描），整文件跑下来近 3 分钟；
// 用默认 5s 超时会**偶发失败**——那是环境慢，不是断言错。这里给足时间，
// 让失败只代表真实问题（2026-09-21 实测：单独跑全过，但单例耗时 4–6s）。
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const run = promisify(execFile);
let repo: string;
let plainDir: string;

async function g(args: string[], cwd = repo): Promise<void> {
  await run('git', args, { cwd, windowsHide: true });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'jujia-git-'));
  plainDir = await mkdtemp(join(tmpdir(), 'jujia-plain-'));
  await g(['init', '-q']);
  await g(['config', 'user.email', 'test@example.com']);
  await g(['config', 'user.name', 'Test']);
  await g(['config', 'commit.gpgsign', 'false']);
  // 建一个初始提交：真实仓库几乎都有 HEAD，空仓库不是常态（且部分 git 命令在无 HEAD 时行为不同）
  await writeFile(join(repo, '.gitkeep'), '', 'utf8');
  await g(['add', '.gitkeep']);
  await g(['commit', '-qm', 'init']);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(plainDir, { recursive: true, force: true });
});

describe('isGitRepo / getStatus', () => {
  it('识别 git 仓库与非仓库', async () => {
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(plainDir)).toBe(false);
  });

  it('非仓库时给出可读错误（不抛异常）', async () => {
    const r = await getStatus(plainDir);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不是 Git 仓库');
  });

  it('返回分支名与改动条目', async () => {
    await writeFile(join(repo, 'a.txt'), 'hello', 'utf8');
    const r = await getStatus(repo);
    expect(r.ok).toBe(true);
    expect(r.data?.isRepo).toBe(true);
    expect(r.data?.branch).toBeTruthy(); // 有初始提交后一定能拿到分支名
    expect(r.data?.entries.some((e) => e.path === 'a.txt')).toBe(true);
    expect(r.data?.entries[0]?.label).toBeTruthy();
  });

  it('文件名含空格与中文也能正确解析（-z NUL 分隔）', async () => {
    await writeFile(join(repo, '我的 测试 文件.txt'), 'x', 'utf8');
    const r = await getStatus(repo);
    expect(r.data?.entries.some((e) => e.path === '我的 测试 文件.txt')).toBe(true);
  });
});

describe('isNoisePath：噪音识别', () => {
  it.each([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'dist/bundle.js',
    'out/main/index.js',
    'app.min.js',
    'index.js.map',
  ])('%s 是噪音', (p) => {
    expect(isNoisePath(p)).toBe(true);
  });

  it.each(['src/index.ts', 'README.md', 'docs/PLAN.md', 'packages/agent-core/src/tools/git.ts'])(
    '%s 不是噪音',
    (p) => {
      expect(isNoisePath(p)).toBe(false);
    },
  );
});

describe('getDiffSummary：只给关键行，不灌全文', () => {
  it('区分新增/删除行数，并给出关键行摘录', async () => {
    await writeFile(join(repo, 'code.ts'), 'export function a() {\n  return 1;\n}\n', 'utf8');
    await g(['add', '.']);
    await g(['commit', '-qm', 'init']);
    await writeFile(
      join(repo, 'code.ts'),
      'export function a() {\n  return 2;\n}\n\nexport function b() {\n  return 3;\n}\n',
      'utf8',
    );

    const r = await getDiffSummary(repo);
    expect(r.ok).toBe(true);
    const f = r.data?.files.find((x) => x.path === 'code.ts');
    expect(f).toBeTruthy();
    expect(f?.added).toBeGreaterThan(0);
    expect(f?.highlights.join('\n')).toContain('export function b()');
  });

  it('纯括号/空行这类低信息量内容不会占满摘录', async () => {
    await writeFile(join(repo, 'x.ts'), 'const a = 1;\n', 'utf8');
    await g(['add', '.']);
    await g(['commit', '-qm', 'init']);
    // 大量纯括号行 + 一行有信息量的
    const noisy = ['const obj = {', ...Array.from({ length: 40 }, () => '  }'), '  real: 1,'].join('\n');
    await writeFile(join(repo, 'x.ts'), `${noisy}\n`, 'utf8');

    const r = await getDiffSummary(repo);
    const f = r.data?.files.find((x) => x.path === 'x.ts');
    expect(f?.highlights.some((h) => h.includes('real: 1'))).toBe(true);
  });

  it('单文件摘录有上限，超出**如实标注截断**', async () => {
    await writeFile(join(repo, 'big.ts'), 'x\n', 'utf8');
    await g(['add', '.']);
    await g(['commit', '-qm', 'init']);
    const many = Array.from({ length: 100 }, (_, i) => `const line${i} = ${i};`).join('\n');
    await writeFile(join(repo, 'big.ts'), `${many}\n`, 'utf8');

    const r = await getDiffSummary(repo);
    const f = r.data?.files.find((x) => x.path === 'big.ts');
    expect(f?.highlights.length).toBe(DIFF_HIGHLIGHTS_PER_FILE);
    expect(f?.truncated).toBe(true);
  });

  it('噪音文件被标出并单独计数（提示无需逐个审阅）', async () => {
    await writeFile(join(repo, 'package-lock.json'), '{"a":1}\n', 'utf8');
    await writeFile(join(repo, 'src.ts'), 'export const a = 1;\n', 'utf8');

    const r = await getDiffSummary(repo);
    // 未跟踪文件也必须出现（git diff 看不到它们，是真实缺口）
    expect(r.data?.files.find((f) => f.path === 'package-lock.json')).toBeTruthy();
    expect(r.data?.files.find((f) => f.path === 'src.ts')).toBeTruthy();
    expect(r.data?.noiseFiles).toBe(1);
    expect(r.data?.note).toContain('噪音');
    expect(r.data?.files.find((f) => f.path === 'package-lock.json')?.noise).toBe(true);
  });

  it('新增（未跟踪）文件也会被汇总，并给出内容摘录', async () => {
    await writeFile(join(repo, 'new.ts'), 'export const x = 1;\nexport const y = 2;\n', 'utf8');
    const r = await getDiffSummary(repo);
    const f = r.data?.files.find((x) => x.path === 'new.ts');
    expect(f).toBeTruthy();
    expect(f?.added).toBe(2);
    expect(f?.highlights.join('\n')).toContain('export const x = 1;');
  });

  it('暂存区 diff（staged）与工作区 diff 区分', async () => {
    await writeFile(join(repo, 's.ts'), 'a\n', 'utf8');
    await g(['add', '.']);
    const staged = await getDiffSummary(repo, true);
    expect(staged.data?.files.some((f) => f.path === 's.ts')).toBe(true);
    const unstaged = await getDiffSummary(repo, false);
    expect(unstaged.data?.files.some((f) => f.path === 's.ts')).toBe(false);
  });
});

describe('写操作（调用方需先过权限门）', () => {
  it('stage → commit 可用，且能读到提交记录', async () => {
    await writeFile(join(repo, 'n.txt'), 'x', 'utf8');
    expect((await stagePaths(repo, ['n.txt'])).ok).toBe(true);
    const c = await commit(repo, '第一次提交');
    expect(c.ok).toBe(true);
    const log = await getRecentCommits(repo, 5);
    expect(log.ok).toBe(true);
    expect(log.data?.join()).toContain('第一次提交');
  });

  it('unstage 可用', async () => {
    await writeFile(join(repo, 'u.txt'), 'x', 'utf8');
    await stagePaths(repo, ['u.txt']);
    expect((await getStatus(repo)).data?.entries.some((e) => e.code.startsWith('A'))).toBe(true);
    expect((await unstagePaths(repo, ['u.txt'])).ok).toBe(true);
    expect((await getStatus(repo)).data?.entries.some((e) => e.code === '??')).toBe(true);
  });

  it('含空格与中文的路径也能正确暂存（参数数组，不拼 shell）', async () => {
    const name = '我的 文件.txt';
    await writeFile(join(repo, name), 'x', 'utf8');
    expect((await stagePaths(repo, [name])).ok).toBe(true);
    expect((await getStatus(repo)).data?.entries.find((e) => e.path === name)?.code.startsWith('A')).toBe(true);
  });

  it('空提交信息 / 超长信息被拒绝（不调用 git）', async () => {
    expect((await commit(repo, '   ')).ok).toBe(false);
    expect((await commit(repo, 'x'.repeat(2001))).ok).toBe(false);
  });

  it('未指定路径时写操作直接拒绝', async () => {
    expect((await stagePaths(repo, [])).ok).toBe(false);
    expect((await unstagePaths(repo, [])).ok).toBe(false);
  });
});

describe('getRecentCommits', () => {
  it('**没有任何提交**的仓库给出可读错误而不是抛异常', async () => {
    // 注意：不能复用外层夹具（它已建过初始提交），这里单独造一个无提交的仓库
    const empty = await mkdtemp(join(tmpdir(), 'jujia-empty-'));
    try {
      await run('git', ['init', '-q'], { cwd: empty, windowsHide: true });
      const r = await getRecentCommits(empty, 3);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe('string');
      expect((r.error ?? '').length).toBeGreaterThan(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('count 被夹在 1–100 之间', async () => {
    await writeFile(join(repo, 'a'), 'a', 'utf8');
    await stagePaths(repo, ['a']);
    await commit(repo, 'c1');
    expect((await getRecentCommits(repo, 0)).ok).toBe(true);
    expect((await getRecentCommits(repo, 999)).ok).toBe(true);
  });
});

/**
 * 逐行 patch（M19 的 diff 视图要用）。与摘要的分别就一句话：
 * 摘要**只留关键行**（省上下文），patch 要**逐行原文**（给人看改动）——
 * 两者共用同一个 `git diff` 口径，所以能力上不是新增，只是不再精简。
 * 边界仍然要有：行数上限，超了截断并如实标注。
 */
describe('getDiffPatch：逐行原文，但有界', () => {
  it('一个文件的改动逐行取回，且带 +/- 与文件路径', async () => {
    await writeFile(join(repo, 'a.txt'), '第一行\n第二行\n', 'utf8');
    await g(['add', 'a.txt']);
    await g(['commit', '-qm', 'add a']);
    await writeFile(join(repo, 'a.txt'), '第一行\n改过的第二行\n', 'utf8');

    const res = await getDiffPatch(repo, false);
    expect(res.ok).toBe(true);
    const files = res.data ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('a.txt');
    expect(files[0]?.text).toContain('-第二行');
    expect(files[0]?.text).toContain('+改过的第二行');
    expect(files[0]?.truncated).toBe(false);
  });

  it('只看指定文件时不带出别的文件', async () => {
    for (const name of ['a.txt', 'b.txt']) {
      await writeFile(join(repo, name), 'x\n', 'utf8');
      await g(['add', name]);
    }
    await g(['commit', '-qm', 'two']);
    await writeFile(join(repo, 'a.txt'), 'a 改了\n', 'utf8');
    await writeFile(join(repo, 'b.txt'), 'b 改了\n', 'utf8');

    const res = await getDiffPatch(repo, false, 'b.txt');
    expect(res.ok).toBe(true);
    expect((res.data ?? []).map((f) => f.path)).toEqual(['b.txt']);
  });

  it('超过行数上限就截断，并把"还有多少行"写在文本里（不静默）', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `行 ${String(i)}`);
    await writeFile(join(repo, 'big.txt'), 'x\n', 'utf8');
    await g(['add', 'big.txt']);
    await g(['commit', '-qm', 'big']);
    await writeFile(join(repo, 'big.txt'), `${lines.join('\n')}\n`, 'utf8');

    const res = await getDiffPatch(repo, false, undefined, 40);
    const file = (res.data ?? [])[0];
    expect(file?.truncated).toBe(true);
    expect(file?.lines).toBe(40);
    expect(file?.text).toContain('已截断');
    expect(file?.text).toContain('共');
  });
});
