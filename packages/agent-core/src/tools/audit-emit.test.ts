import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listDirTool,
  readFileTool,
  writeFileTool,
} from './builtin/file-tools';
import { runCommandTool } from './builtin/exec-tool';
import type { GateAuditInfo } from '../audit/record';
import { runTool } from './executor';
import { createDefaultRegistry } from './registry';
import { noopHookRunner } from '../hooks/types';

/**
 * 判定事实的出口（M4 收尾 · 其二）。
 *
 * 要锁的不是"有没有回调"，而是**每一条分支都只交一次、且交的是真实那一面**：
 * 漏一条分支，账本就会看起来"今天没发生这件事"；重复交，同一次执行会出现两条
 * 互相矛盾的答复。这两件事都只能靠断言钉，注释钉不住。
 */

let root: string;
const ctx = () => ({ workspaceRoot: root });

function collector() {
  const seen: GateAuditInfo[] = [];
  return { seen, onDecision: (info: GateAuditInfo) => void seen.push(info) };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-audit-exec-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runTool 的判定出口', () => {
  it('只读放行：一条记录，outcome=allow、没问过、执行了', async () => {
    const c = collector();
    await runTool(readFileTool, { path: '没有这个文件.txt' }, ctx(), async () => 'deny', {
      onDecision: c.onDecision,
    });
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]).toMatchObject({ outcome: 'allow', asked: false, executed: true, toolName: 'read_file' });
    expect(c.seen[0]?.answer).toBeUndefined();
    expect(c.seen[0]?.reason).toContain('只读');
  });

  it('规则直接拒：outcome=deny、没问过、**executed=false**（没做的事不许记成做过）', async () => {
    const c = collector();
    await runTool(writeFileTool, { path: 'a.txt', content: 'x' }, ctx(), async () => 'allow_once', {
      onDecision: c.onDecision,
      rules: [
        { id: 'r1', pattern: 'write_file', action: 'deny', enabled: true, createdAt: '', updatedAt: '' },
      ],
    });
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]).toMatchObject({ outcome: 'deny', asked: false, executed: false });
    expect(c.seen[0]?.reason).toContain('命中你的规则');
  });

  it('问过一次：答复原样进账，且只进一条（同一次执行出现两条 = 账不可信）', async () => {
    const c = collector();
    await runTool(
      writeFileTool,
      { path: 'a.txt', content: 'x' },
      ctx(),
      async () => 'allow_once',
      { onDecision: c.onDecision },
    );
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]).toMatchObject({ outcome: 'ask', asked: true, answer: 'allow_once', executed: true });
  });

  it('用户拒绝：asked=true + answer=deny + executed=false', async () => {
    const c = collector();
    await runTool(writeFileTool, { path: 'a.txt', content: 'x' }, ctx(), async () => 'deny', {
      onDecision: c.onDecision,
    });
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]).toMatchObject({ asked: true, answer: 'deny', executed: false });
  });

  it('等待超时：answer=timeout，与"用户拒绝"分开（两种事实两种记法）', async () => {
    const c = collector();
    await runTool(writeFileTool, { path: 'a.txt', content: 'x' }, ctx(), async () => 'timeout', {
      onDecision: c.onDecision,
    });
    expect(c.seen[0]).toMatchObject({ asked: true, answer: 'timeout', executed: false });
  });

  it('软 ask 被「总是允许」压掉：outcome 仍是 ask，但 asked=false（不许记成问过）', async () => {
    const c = collector();
    const opts = { onDecision: c.onDecision, alwaysAllow: new Set<string>() };
    // 先正常允许一次并回答"总是允许"
    await runTool(writeFileTool, { path: 'a.txt', content: 'x' }, ctx(), async () => 'allow_always', opts);
    expect(c.seen[0]).toMatchObject({ asked: true, answer: 'allow_always' });
    // 第二次不再问
    await runTool(writeFileTool, { path: 'b.txt', content: 'y' }, ctx(), async () => 'deny', opts);
    expect(c.seen).toHaveLength(2);
    expect(c.seen[1]).toMatchObject({ outcome: 'ask', asked: false, executed: true });
    expect(c.seen[1]?.answer).toBeUndefined();
  });

  it('硬 ask 的 bypassable=false 要如实带出来（否则审计分不清"每次必问"与"可以压掉"）', async () => {
    const c = collector();
    await runTool(runCommandTool, { command: 'node -v' }, ctx(), async () => 'deny', {
      onDecision: c.onDecision,
    });
    expect(c.seen[0]).toMatchObject({ toolName: 'run_command', outcome: 'ask', bypassable: false });
  });

  it('命令行的参数名跟着判定一起出来（审计只认工具的声明，不去猜 args 里哪个是命令）', async () => {
    const c = collector();
    await runTool(runCommandTool, { command: 'git status' }, ctx(), async () => 'allow_once', {
      onDecision: c.onDecision,
    });
    expect(c.seen[0]?.commandArg).toBe('command');

    const d = collector();
    await runTool(listDirTool, { path: '.' }, ctx(), async () => 'deny', { onDecision: d.onDecision });
    expect(d.seen[0]?.commandArg).toBeUndefined();
  });

  it('参数校验就没过：**一条都不记**（那时还没有任何权限判定，记进去等于凭空造一条）', async () => {
    const c = collector();
    const res = await runTool(writeFileTool, { nope: 1 }, ctx(), async () => 'allow_once', {
      onDecision: c.onDecision,
    });
    expect(res.outcome.ok).toBe(false);
    expect(c.seen).toEqual([]);
  });

  it('钩子拒绝：记成 deny，理由里写着"钩子"（不是用户拒的，别记到用户头上）', async () => {
    const c = collector();
    await runTool(writeFileTool, { path: 'a.txt', content: 'x' }, ctx(), async () => 'allow_once', {
      onDecision: c.onDecision,
      hooks: {
        async run() {
          return {
            blocked: true,
            reason: '本项目不允许写文件',
            additionalContext: [],
            updatedInput: null,
            permissionDecision: null,
            permissionReason: null,
            continueTurn: false,
            diagnostics: [],
            ranCount: 0,
          };
        },
      },
    });
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]).toMatchObject({ outcome: 'deny', asked: false, executed: false });
    expect(c.seen[0]?.reason).toContain('钩子');
    expect(c.seen[0]?.reason).toContain('本项目不允许写文件');
  });

  it('画布与注册表走的是同一个出口（工具执行只有一个入口，审计也只有一个）', async () => {
    const registry = createDefaultRegistry();
    const c = collector();
    await runTool(registry.get('read_file'), { path: '不存在.md' }, ctx(), async () => 'deny', {
      onDecision: c.onDecision,
    });
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]?.toolName).toBe('read_file');
  });

  it('不传 onDecision 时行为与从前完全一致（不许为了审计改变执行语义）', async () => {
    const res = await runTool(readFileTool, { path: 'nope.txt' }, ctx(), async () => 'deny');
    expect(res.outcome.ok).toBe(false);
    expect(noopHookRunner).toBeDefined();
  });
});
