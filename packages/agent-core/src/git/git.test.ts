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
  isIndexLockError,
  isNoisePath,
  push,
  readUntrackedFile,
  stagePaths,
  type UntrackedFs,
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

  it('正文超过 maxBuffer 读不出来 → 关键行为空必须说一句"读不出来"，不许当成没有改动（T50）', async () => {
    // 2026-10-14 核心包审计线抓到：`const raw = rawRes.ok ? rawRes.stdout : ''` 把失败折成空字符串，
    // 返回仍是 `ok:true`，于是"这次改动没有关键行"与"关键行读不出来"在界面上长得分毫不差。
    // 这里**真的**把它撑爆（`git()` 默认 maxBuffer = 4MB），而不是假设那条路会失败。
    await writeFile(join(repo, 'big.txt'), 'seed\n', 'utf8');
    await g(['add', 'big.txt']);
    await g(['commit', '-qm', 'big-seed']);
    await writeFile(join(repo, 'big.txt'), '改动一行用于撑满缓冲区的内容\n'.repeat(150_000), 'utf8');

    const r = await getDiffSummary(repo);
    expect(r.ok).toBe(true); // 统计那一路是好的，整体不该失败
    const f = r.data?.files.find((x) => x.path === 'big.txt');
    expect(f?.added).toBeGreaterThan(0); // 行数照给
    expect(f?.highlights).toHaveLength(0); // 关键行这一格确实是空的
    expect(r.data?.note ?? '').toContain('读不出来'); // 但必须说得出为什么空

    // 反向对照：把大改动提交掉、只留一个小改动，那句话就不许再出现
    // （否则这条 note 变成"永远在喊读不出来"，等于用一句谎覆盖另一句谎）
    await g(['add', 'big.txt']);
    await g(['commit', '-qm', 'big-apply']);
    await writeFile(join(repo, 'small.txt'), '一行\n', 'utf8');
    const after = await getDiffSummary(repo);
    expect(after.ok).toBe(true);
    expect(after.data?.note ?? '').not.toContain('读不出来');
  }, 60_000);

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

describe('push（M8 收口：外发远端，调用方必须先过硬 ask）', () => {
  /**
   * 这一组测的是**跑得起、拒得掉**：
   * - 真往一个 bare 仓库推一次，用 bare 侧的提交数做真值（不看界面文案）；
   * - 远端名/分支名的形状**先校验再过命令** —— 这里守的是"参数不能被读成选项"
   *   （`git push --all` / `git push -f` 与 `git push` 后跟一个名为 `--all` 的远端，是两回事）；
   * - 不在仓库里 → 可读错误，不抛异常（与 commit/stage 同一口径）。
   */
  let bare = '';

  beforeEach(async () => {
    bare = await mkdtemp(join(tmpdir(), 'jujia-git-bare-'));
    await g(['init', '--bare', '-q'], bare);
    await g(['remote', 'add', 'origin', bare]);
  });

  afterEach(async () => {
    await rm(bare, { recursive: true, force: true });
  });

  /** bare 侧收到几个提交（真值来源，不依赖本地仓库自述） */
  async function bareCommitCount(): Promise<number> {
    const r = await run('git', ['--git-dir', bare, 'rev-list', '--count', '--all'], { windowsHide: true });
    return Number.parseInt(r.stdout.trim(), 10);
  }

  async function currentBranch(): Promise<string> {
    const r = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, windowsHide: true });
    return r.stdout.trim();
  }

  it('推到真远端：bare 侧真的多出那一个提交', async () => {
    await writeFile(join(repo, 'pushable.txt'), 'to remote\n', 'utf8');
    await g(['add', '--', 'pushable.txt']);
    await g(['commit', '-qm', '给远端的那次提交']);
    const before = await bareCommitCount();

    const r = await push(repo, 'origin', await currentBranch());
    expect(r.ok).toBe(true);
    expect(await bareCommitCount()).toBeGreaterThan(before);
  });

  it('分支名留空 = 推当前分支，不猜、不拼字符串', async () => {
    await writeFile(join(repo, 'pushable2.txt'), 'x\n', 'utf8');
    await g(['add', '--', 'pushable2.txt']);
    await g(['commit', '-qm', '第二条']);

    const r = await push(repo, 'origin', null);
    expect(r.ok).toBe(true);
  });

  it.each(['--all', '-f', '--force', '--receive-pack=/tmp/evil.sh', '', '   ', 'origin --mirror'])(
    '远端名 %p 的形状不被允许（拒绝在过命令之前）',
    async (bad) => {
      const r = await push(repo, bad, 'main');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('远端名');
    },
  );

  it('分支名里塞选项同样被拒', async () => {
    const r = await push(repo, 'origin', 'main --force');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('分支');
  });

  it('不在仓库里 → 可读错误而不是抛异常', async () => {
    const r = await push(plainDir, 'origin', null);
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});

/**
 * T29：diff 摘要里"未跟踪文件"的内容读取。
 *
 * 外部审查的原话是"软链把工作区外的内容带进 git 历史"—— 实测**不成立**
 * （`git add` 之后索引里是 mode 120000，`cat-file` 拿到的是链接目标那串文本，
 * 内容根本没进仓库，复核 055 记的是这次实测）。
 * 但**读**那一侧是真的：`getDiffSummary` 对未跟踪条目直接 `readFile(join(cwd, path))`，
 * 跟着软链就把外部文件的内容读进了界面。所以这里拦的是读，不动 `git add`
 * （提交一个软链是正常需求，拦它会把真仓库打死）。
 *
 * 这几条用例用**注入的 fs**，不建真软链：Windows 上建符号链接要开发者模式，
 * 用真链路测出来的绿不可靠（换台机器就红），而判据本身是纯逻辑。
 */
describe('readUntrackedFile：未跟踪条目的内容读取只跟普通文件', () => {
  const text = 'const a = 1\n\n  // 注释 \n{}\nfunction f() {\n}\n';

  const fakeFs = (opts: {
    link?: boolean;
    content?: string;
    fail?: boolean;
  }): UntrackedFs & { readCalls: { value: number } } => {
    const readCalls = { value: 0 };
    return {
      lstat: async () => ({ isSymbolicLink: () => opts.link === true }),
      readFile: async () => {
        readCalls.value += 1;
        if (opts.fail) throw new Error('EISDIR');
        return opts.content ?? text;
      },
      readCalls,
    };
  };

  it('普通文件：非空行数 + 带 + 前缀的摘录，且没有说明（现状行为原样保住）', async () => {
    const r = await readUntrackedFile('/ws/a.ts', fakeFs({}));
    expect(r.note).toBeNull();
    expect(r.added).toBe(text.split('\n').filter((l) => l.trim() !== '').length);
    expect(r.highlights.every((l) => l.startsWith('+ '))).toBe(true);
  });

  it('符号链接：一次都不读内容，并给出看得见的理由', async () => {
    const fs = fakeFs({ link: true, content: '外部机密\n第二行\n' });
    const r = await readUntrackedFile('/ws/link.txt', fs);
    expect(fs.readCalls.value).toBe(0);
    expect(r.added).toBe(0);
    expect(r.note).toBe('symbolic-link');
    expect(r.highlights.join(' ')).toContain('符号链接');
    // 说明必须讲清"为什么不读"，只写"跳过"等于让人以为文件是空的
    expect(r.highlights.join(' ')).toContain('工作区之外');
  });

  it('读不到（目录 / 权限 / 二进制）：计 0 但仍列出，不抛', async () => {
    const r = await readUntrackedFile('/ws/somedir', fakeFs({ fail: true }));
    expect(r.added).toBe(0);
    expect(r.highlights).toEqual([]);
    expect(r.note).toBe('unreadable');
  });

  it('摘录有界（limit），且"同一条目读两遍磁盘"的老毛病不许回来', async () => {
    const fs = fakeFs({ content: '一\n二\n三\n四\n五\n' });
    const r = await readUntrackedFile('/ws/many.txt', fs, 3);
    expect(r.highlights.length).toBe(3);
    expect(r.truncated).toBe(true);
    // 一个条目只读一次：以前计数与摘录各读一遍，两处判断会分叉
    expect(fs.readCalls.value).toBe(1);
  });
});

describe('index.lock 的「可见地等」（R24）', () => {
  it('锁一直被占着：有界等待后如实报"被锁、等过、怎么办"，而不是甩一条原始报错', async () => {
    expect(isIndexLockError("fatal: Unable to create 'x/.git/index.lock': File exists.")).toBe(true);
    expect(isIndexLockError('fatal: not a git repository')).toBe(false);
    await writeFile(join(repo, '.git', 'index.lock'), '', 'utf8'); // 手工占锁（另一个 git 进程的形状）
    await writeFile(join(repo, 'lock-held.txt'), 'x', 'utf8');
    const r = await stagePaths(repo, ['lock-held.txt']);
    await rm(join(repo, '.git', 'index.lock'), { force: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('索引被锁');
    expect(r.error).toContain('已等待约');
    expect(r.error).toContain('index.lock');
  });

  it('锁在等待期间被释放：重试成功，note 说明等过（不是静默重试）', async () => {
    await writeFile(join(repo, '.git', 'index.lock'), '', 'utf8');
    await writeFile(join(repo, 'lock-freed.txt'), 'y', 'utf8');
    const timer = setTimeout(() => {
      void rm(join(repo, '.git', 'index.lock'), { force: true });
    }, 500);
    const r = await stagePaths(repo, ['lock-freed.txt']);
    clearTimeout(timer);
    expect(r.ok).toBe(true);
    expect(r.note ?? '').toContain('等待 index.lock');
    // 真的暂存成功了（磁盘真值：索引里看得见它）
    const { stdout } = await run('git', ['diff', '--cached', '--name-only'], { cwd: repo, windowsHide: true });
    expect(stdout).toContain('lock-freed.txt');
  });
});
