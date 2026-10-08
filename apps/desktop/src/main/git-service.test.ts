import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PermissionDecision, PermissionRequest, PermissionResolver } from '@jujia/agent-core';
import { createGitService, type GitPolicy } from './git-service';

/**
 * git 服务层的验收（M8 接线）。
 *
 * 重点不是"git 命令能不能跑"（那是 `agent-core/git.test.ts` 已经钉过的），
 * 而是**权限门这条路真的走过没有**：
 *  - commit 每次都问人，「总是允许」压不掉；
 *  - stage 可以"本次会话总是允许"，第二次就不再问；
 *  - 被拒 / 超时 → **仓库里真的没有多出提交**（不看界面文案，看 git log —— 复核 026 的 G-8 教训）；
 *  - 越界路径在**弹窗之前**就被拦下（不能让用户的点击替越界背书）。
 *
 * 用 `mkdtemp(tmpdir())` 与仓内其它单测保持同一套做法（`json-store.test.ts` 等）；
 * 界面级 e2e 才走 `.tmp/` 隔离，那部分由 `test-policy.test.ts` 看着。
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const run = promisify(execFile);
let repo = '';
const asked: PermissionRequest[] = [];
let answer: PermissionDecision = 'allow_once';

const resolver: PermissionResolver = (req) => {
  asked.push(req);
  return Promise.resolve(answer);
};

const policy = (over: Partial<GitPolicy> = {}): GitPolicy => ({ mode: 'default', rules: [], alwaysAsk: [], ...over });

function makeService(over: Partial<GitPolicy> = {}, root: () => Promise<string | null> = async () => repo) {
  asked.length = 0;
  return createGitService({
    getWorkspaceRoot: root,
    loadPolicy: async () => policy(over),
    resolvePermission: resolver,
  });
}

async function commitCount(): Promise<number> {
  const r = await run('git', ['rev-list', '--count', 'HEAD'], { cwd: repo, windowsHide: true });
  return Number.parseInt(r.stdout.trim(), 10);
}

async function lastSubject(): Promise<string> {
  const r = await run('git', ['log', '-1', '--pretty=%s'], { cwd: repo, windowsHide: true });
  return r.stdout.trim();
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'jujia-git-service-'));
  const g = async (args: string[]): Promise<void> => {
    await run('git', args, { cwd: repo, windowsHide: true });
  };
  await g(['init', '-q']);
  await g(['config', 'user.email', 't@example.invalid']);
  await g(['config', 'user.name', 't']);
  await writeFile(join(repo, 'seed.txt'), 'seed\n', 'utf8');
  await g(['add', '--', 'seed.txt']);
  await g(['commit', '-qm', 'seed']);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

/** 造一个未跟踪的新文件（每个用例单独用，避免互相污染） */
let seq = 0;
async function newFile(): Promise<string> {
  seq += 1;
  const name = `f${String(seq)}.txt`;
  await writeFile(join(repo, name), `content ${String(seq)}\n`, 'utf8');
  return name;
}

describe('只读查询不过权限门', () => {
  it('status / diff / log 一次都不问，且能读到真实内容', async () => {
    const svc = makeService();
    const name = await newFile();
    expect(asked.length).toBe(0);

    const st = await svc.status();
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    const entries = (st.data as { entries: Array<{ path: string }> }).entries;
    expect(entries.some((e) => e.path === name)).toBe(true);

    // 注意 data 是**字符串数组**（每行一条提交），断言要看元素本身
    const log = await svc.log(10);
    expect(log.ok).toBe(true);
    if (!log.ok) return;
    expect(log.data.some((line) => line.endsWith('seed'))).toBe(true);
    expect(asked.length).toBe(0);
  });

  it('工作区不是仓库时给可读理由，而不是抛异常', async () => {
    const svc = makeService({}, async () => tmpdir());
    const r = await svc.status();
    expect(r.ok === false && /不是 Git 仓库|无法使用 git/.test(r.error)).toBe(true);
  });

  it('没选工作区时说清楚', async () => {
    const svc = makeService({}, async () => null);
    const r = await svc.commit('随便写点什么');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('还没有选择工作区');
  });
});

describe('commit 是硬 ask：每次都问，「总是允许」压不掉', () => {
  it('第一次问；回答 allow_always 之后**第二次还是要问**', async () => {
    answer = 'allow_always';
    const svc = makeService();
    const name = await newFile();
    expect((await svc.stage([name])).ok).toBe(true);

    const before = await commitCount();
    const r1 = await svc.commit('第一次提交');
    expect(r1.ok).toBe(true);
    expect(r1.asked).toBe(true);
    expect(asked.length).toBe(2); // 第一次是 stage 的软 ask，第二次才是 commit

    const name2 = await newFile();
    expect((await svc.stage([name2])).ok).toBe(true); // 软 ask 已被记住 → 不再问
    expect(asked.length).toBe(2);

    const r2 = await svc.commit('第二次提交');
    expect(r2.asked).toBe(true);
    expect(asked.length).toBe(3); // commit 仍然问了 —— 没有被 allow_always 压掉
    expect(await commitCount()).toBe(before + 2);
    expect(svc.alwaysAllowed()).toEqual(['git_stage']); // **只有软 ask 进白名单**
  });

  it('弹窗文案写明「会写入仓库历史」，工具名是 git_commit', async () => {
    answer = 'allow_once';
    const svc = makeService();
    const name = await newFile();
    await svc.stage([name]);
    await svc.commit('带说明的提交');
    const req = asked.find((r) => r.toolName === 'git_commit');
    expect(req?.summary).toContain('会写入仓库历史');
    expect(req?.summary).toContain('带说明的提交');
  });

  it('拒绝 → 仓库里**真的没有**多出提交（不看提示，看 git log）', async () => {
    const svc = makeService();
    answer = 'allow_once';
    const name = await newFile();
    expect((await svc.stage([name])).ok).toBe(true);
    answer = 'deny';
    const before = await commitCount();
    const r = await svc.commit('不该存在的提交');
    expect(r.ok).toBe(false);
    expect(r.asked).toBe(true);
    expect(r.decision).toBe('deny');
    expect(await commitCount()).toBe(before);
  });

  it('超时同样不执行，并给出可读理由', async () => {
    const svc = makeService();
    answer = 'allow_once';
    const name = await newFile();
    await svc.stage([name]);
    answer = 'timeout';
    const before = await commitCount();
    const r = await svc.commit('超时提交');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('超时');
    expect(await commitCount()).toBe(before);
  });

  it('allow_once 之后能查到提交内容', async () => {
    answer = 'allow_once';
    const svc = makeService();
    const name = await newFile();
    await svc.stage([name]);
    expect((await svc.commit('落地一次')).ok).toBe(true);
    expect(await lastSubject()).toBe('落地一次');
  });
});

describe('stage / unstage 是软 ask：可逆，允许"本次会话总是允许"', () => {
  it('第一次问，allow_always 后第二次不问，且 unstage 仍单独问', async () => {
    answer = 'allow_always';
    const svc = makeService();
    const a = await newFile();
    expect((await svc.stage([a])).ok).toBe(true);
    expect(asked.length).toBe(1);
    expect(asked[0]?.toolName).toBe('git_stage');

    const b = await newFile();
    expect((await svc.stage([b])).ok).toBe(true);
    expect(asked.length).toBe(1); // 记住了

    expect((await svc.unstage([b])).ok).toBe(true);
    expect(asked.length).toBe(2); // unstage 是另一个工具名，另问
    expect(asked[1]?.toolName).toBe('git_unstage');
    expect([...svc.alwaysAllowed()].sort()).toEqual(['git_stage', 'git_unstage']);
  });

  it('allow_once 不记白名单：下一次照样问', async () => {
    answer = 'allow_once';
    const svc = makeService();
    const a = await newFile();
    await svc.stage([a]);
    const b = await newFile();
    await svc.stage([b]);
    expect(asked.length).toBe(2);
    expect(svc.alwaysAllowed()).toEqual([]);
  });
});

describe('越界路径在弹窗之前就被拦', () => {
  it('指向仓库外的路径 → 不问人、不执行', async () => {
    answer = 'allow_always';
    const svc = makeService();
    const r = await svc.stage(['../../etc/passwd']);
    expect(r.ok).toBe(false);
    expect(asked.length).toBe(0);
    expect(r.error).toContain('路径被拒绝');
  });

  it('指向仓库根（等于整仓暂存）也拒绝 —— 那会让用户以为只提交了选中的文件', async () => {
    const svc = makeService();
    const r = await svc.stage(['.']);
    expect(r.ok).toBe(false);
    expect(asked.length).toBe(0);
  });

  it('空清单不弹窗、不执行', async () => {
    const svc = makeService();
    expect((await svc.stage([])).ok).toBe(false);
    expect(asked.length).toBe(0);
  });
});

describe('策略优先于弹窗（与工具执行同一套语义）', () => {
  it('用户写了 deny 规则 → 直接拒，不问', async () => {
    const svc = makeService({
      rules: [
        {
          id: 'r1',
          pattern: 'git_commit',
          action: 'deny',
          enabled: true,
          createdAt: '2026-09-24T00:00:00.000Z',
          updatedAt: '2026-09-24T00:00:00.000Z',
        },
      ],
    });
    const name = await newFile();
    await svc.stage([name]);
    const before = await commitCount();
    const r = await svc.commit('被规则挡住');
    expect(r.ok).toBe(false);
    expect(r.decision).toBe('policy:deny');
    expect(asked.some((a) => a.toolName === 'git_commit')).toBe(false);
    expect(await commitCount()).toBe(before);
  });

  it('plan 模式下 commit 直接被拒（只读模式不该有任何写入）', async () => {
    const svc = makeService({ mode: 'plan' });
    const r = await svc.commit('计划模式下不许');
    expect(r.ok).toBe(false);
    expect(r.decision).toBe('policy:deny');
  });
});

describe('push（M8 收口）：真远端做真值', () => {
  /**
   * 这里看的不是返回值说了什么，而是**bare 仓库那边到底收到没收到** ——
   * 与 commit 那一组同一个道理（复核 026 的 G-8 教训：拒绝必须拿磁盘/仓库证据，不能拿文案）。
   */
  let bare = '';

  async function bareCount(): Promise<number> {
    const r = await run('git', ['--git-dir', bare, 'rev-list', '--count', '--all'], { windowsHide: true });
    return Number.parseInt(r.stdout.trim(), 10);
  }

  async function branchName(): Promise<string> {
    const r = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, windowsHide: true });
    return r.stdout.trim();
  }

  /** 提交一个已 staged 的新文件，让远端有新东西可收 */
  async function commitSomething(label: string): Promise<void> {
    const name = await newFile();
    const svc = makeService();
    answer = 'allow_once';
    expect((await svc.stage([name])).ok).toBe(true);
    expect((await svc.commit(label)).ok).toBe(true);
  }

  beforeAll(async () => {
    bare = await mkdtemp(join(tmpdir(), 'jujia-git-bare-svc-'));
    await run('git', ['init', '--bare', '-q'], { cwd: bare, windowsHide: true });
    await run('git', ['remote', 'add', 'origin', bare], { cwd: repo, windowsHide: true });
  });

  afterAll(async () => {
    await rm(bare, { recursive: true, force: true });
  });

  it('批准 → 远端真的多出那一次', async () => {
    answer = 'allow_once';
    await commitSomething('要推上去的第一次');
    const before = await bareCount();

    const svc = makeService();
    const r = await svc.push('origin', await branchName());
    expect(r.ok).toBe(true);
    expect(r.asked).toBe(true);
    expect(await bareCount()).toBeGreaterThan(before);
  });

  it('拒绝 → **远端一个字节都没多**（不是"显示了拒绝文案"就算过）', async () => {
    // 顺序有讲究：commitSomething() 内部会把回答改回 allow_once（它自己要过两次门），
    // 所以"拒绝"必须设在它**之后** —— 写在前面会被它覆盖掉，测出来的是"批准也算拒绝"的假绿。
    await commitSomething('本地有、远端不该有');
    answer = 'deny';
    const before = await bareCount();

    const svc = makeService();
    const r = await svc.push('origin', await branchName());
    expect(r.ok).toBe(false);
    expect(r.decision).toBe('deny');
    expect(await bareCount()).toBe(before);
  });

  it('每次都问：allow_always 也压不掉，白名单里绝不出现 git_push', async () => {
    answer = 'allow_always';
    const svc = makeService();
    const b = await branchName();

    asked.length = 0;
    expect((await svc.push('origin', b)).ok).toBe(true);
    expect(asked.filter((a) => a.toolName === 'git_push').length).toBe(1);

    expect((await svc.push('origin', b)).ok).toBe(true);
    // 第二次**仍然要问** —— 外发不给"本次会话总是允许"这条捷径
    expect(asked.filter((a) => a.toolName === 'git_push').length).toBe(2);
    expect(svc.alwaysAllowed()).not.toContain('git_push');
  });

  it('acceptEdits 不覆盖外发（那个模式说的是"编辑文件"）', async () => {
    answer = 'deny';
    const svc = makeService({ mode: 'acceptEdits' });
    const before = await bareCount();
    const r = await svc.push('origin', await branchName());
    expect(r.asked).toBe(true); // 真的问了，而不是自动放行
    expect(r.ok).toBe(false);
    expect(await bareCount()).toBe(before);
  });

  it('弹窗带远端与分支，且 bypassable=false（按钮不会长出「总是允许」）', async () => {
    answer = 'deny';
    const svc = makeService();
    const b = await branchName();
    await svc.push('origin', b);
    const req = asked.find((a) => a.toolName === 'git_push');
    expect(req?.bypassable).toBe(false);
    expect(req?.summary).toContain('origin');
    expect(req?.summary).toContain(b);
  });

  it('远端不存在时给可读错误，不抛异常', async () => {
    answer = 'allow_once';
    const svc = makeService();
    const r = await svc.push('没有配过的远端', await branchName());
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.error).not.toBe('');
  });
});
