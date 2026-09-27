import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyHookResult, type HookRunParams, type HookRunResult } from '../hooks/types';
import { readFileTool, writeFileTool } from './builtin/file-tools';
import {
  runTool,
  type PermissionAnswer,
  type PermissionDecision,
  type PermissionRequest,
} from './executor';
import type { ToolDefinition, ToolOutcome } from './types';

/**
 * **硬 ask / 软 ask**（2026-09-23）。
 *
 * 背景：原先"本次会话总是允许"是按**工具名**记的，于是它同时压掉了三类本该每次都问的情况：
 * 高危清单、用户自己写的 `ask` 规则、敏感路径 —— 并且**连带跳过了 PermissionRequest 钩子**。
 * 对一个把"副作用动作都要你点头"当卖点的 Agent 来说，这是自相矛盾的。
 *
 * 现在的语义：
 * - **软 ask**（默认写文件）：可以被「总是允许」压掉；
 * - **硬 ask**（高危清单 / 用户 ask 规则 / 敏感路径 / 执行类命令）：任何「总是允许」都压不掉，
 *   而且审批钩子照常运行。
 */

let root: string;
const ctx = (): { workspaceRoot: string } => ({ workspaceRoot: root });

function fixedResolver(decision: PermissionDecision | PermissionAnswer): {
  resolver: (req: PermissionRequest) => Promise<PermissionDecision | PermissionAnswer>;
  asked: PermissionRequest[];
} {
  const asked: PermissionRequest[] = [];
  return {
    asked,
    resolver: (req) => {
      asked.push(req);
      return Promise.resolve(decision);
    },
  };
}

/** 记录被触发过哪些钩子事件（返回空结果 = 钩子不干预） */
function recordingHooks(): {
  events: string[];
  runner: { run: (params: HookRunParams) => Promise<HookRunResult> };
} {
  const events: string[] = [];
  return {
    events,
    runner: {
      run: (params) => {
        events.push(params.event);
        return Promise.resolve(emptyHookResult());
      },
    },
  };
}

/** 一个最小的"执行类"工具：kind=exec，用来验证执行命令属于硬 ask */
const fakeExecTool: ToolDefinition<{ command: string }> = {
  name: 'fake_run',
  description: '测试用的执行类工具',
  kind: 'exec',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  parse: (raw) => raw as { command: string },
  run: (): Promise<ToolOutcome> => Promise.resolve({ ok: true, content: 'ran' }),
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-hardask-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('软 ask：可以被「本次会话总是允许」压掉', () => {
  it('普通路径写文件：记住「总是允许」后不再询问（这是它该有的用处）', async () => {
    const alwaysAllow = new Set<string>();
    const first = fixedResolver('allow_always');
    await runTool(writeFileTool as never, { path: 'a.txt', content: '1' }, ctx(), first.resolver, {
      alwaysAllow,
    });
    expect(first.asked).toHaveLength(1);
    expect(alwaysAllow.has('write_file')).toBe(true);

    const second = fixedResolver('deny');
    const res = await runTool(
      writeFileTool as never,
      { path: 'b.txt', content: '2' },
      ctx(),
      second.resolver,
      { alwaysAllow },
    );
    expect(second.asked).toHaveLength(0);
    expect(res.outcome.ok).toBe(true);
  });
});

describe('硬 ask：任何「总是允许」都压不掉', () => {
  it('敏感路径（.env）：即使已记住「总是允许」也**必须再问**', async () => {
    const { resolver, asked } = fixedResolver('deny');
    const res = await runTool(
      writeFileTool as never,
      { path: join(root, '.env'), content: 'SECRET=1' },
      ctx(),
      resolver,
      { alwaysAllow: new Set(['write_file']) },
    );

    expect(asked).toHaveLength(1); // 关键：压不掉
    expect(asked[0]?.toolName).toBe('write_file');
    expect(res.asked).toBe(true);
    expect(res.outcome.ok).toBe(false); // 用户（这里）拒绝了
  });

  /**
   * 外部审查 T1 的**运行时**证据（策略层的对应用例在 `permissions/policy.test.ts`）。
   * 修之前这条链路是：只读 → 直接放行 → 一句都不问，密钥静默进模型上下文。
   */
  it('只读工具读敏感路径也必须问，而且弹窗标题要写清"为什么问"', async () => {
    const { resolver, asked } = fixedResolver('deny');
    const res = await runTool(
      readFileTool as never,
      { path: join(root, '.env') },
      ctx(),
      resolver,
      { alwaysAllow: new Set(['read_file']) },
    );

    expect(asked).toHaveLength(1); // 「总是允许」压不掉，而且读也一样
    expect(res.asked).toBe(true);
    expect(res.outcome.ok).toBe(false);
    // 标题里必须看得见理由：只写"read_file · 读取"时，读 .env 与读 README 长得一模一样，
    // 用户只能凭惯性点允许 —— 分级判定的价值会被弹窗自己抹平
    expect(asked[0]?.summary).toContain('目标是敏感路径');
  });

  it('dontAsk 模式读敏感文件：直接拒绝，**连一次都不问**（该模式不给询问机会）', async () => {
    const { resolver, asked } = fixedResolver('allow_once');
    const res = await runTool(
      readFileTool as never,
      { path: join(root, '.env') },
      ctx(),
      resolver,
      { mode: 'dontAsk' },
    );
    expect(asked).toHaveLength(0);
    expect(res.asked).toBe(false);
    expect(res.outcome.ok).toBe(false);
  });

  it('执行类命令：即使已记住「总是允许」也**必须再问**（按工具名放行 = 放行任意命令）', async () => {
    const { resolver, asked } = fixedResolver('deny');
    await runTool(fakeExecTool, { command: 'echo hi' }, ctx(), resolver, {
      alwaysAllow: new Set(['fake_run']),
    });
    expect(asked).toHaveLength(1);
  });

  it('高危清单命中的工具：即使已记住「总是允许」也**必须再问**', async () => {
    const { resolver, asked } = fixedResolver('deny');
    await runTool(writeFileTool as never, { path: 'a.txt', content: '1' }, ctx(), resolver, {
      alwaysAllow: new Set(['write_file']),
      alwaysAsk: ['write_file'],
    });
    expect(asked).toHaveLength(1);
  });

  it('用户自己写的 ask 规则：即使已记住「总是允许」也**必须再问**', async () => {
    const { resolver, asked } = fixedResolver('deny');
    await runTool(writeFileTool as never, { path: 'a.txt', content: '1' }, ctx(), resolver, {
      alwaysAllow: new Set(['write_file']),
      rules: [
        { id: 'r1', pattern: 'write_file', action: 'ask', enabled: true, createdAt: '', updatedAt: '' },
      ],
    });
    expect(asked).toHaveLength(1);
  });
});

describe('审批钩子不能被「总是允许」连带废掉', () => {
  it('硬 ask 时 PermissionRequest 钩子**照常运行**（它可能拒绝）', async () => {
    const hooks = recordingHooks();
    const { resolver, asked } = fixedResolver('deny');
    await runTool(
      writeFileTool as never,
      { path: join(root, '.env'), content: 'SECRET=1' },
      ctx(),
      resolver,
      { alwaysAllow: new Set(['write_file']), hooks: hooks.runner },
    );

    expect(hooks.events).toContain('PermissionRequest');
    // 钩子跑了，弹窗也仍然出现（钩子没有否决时）
    expect(asked).toHaveLength(1);
  });

  it('软 ask 且已记住「总是允许」时，钩子**不该**再被调用（确实不需要打扰任何人）', async () => {
    const hooks = recordingHooks();
    const { resolver, asked } = fixedResolver('deny');
    const res = await runTool(
      writeFileTool as never,
      { path: 'plain.txt', content: '1' },
      ctx(),
      resolver,
      { alwaysAllow: new Set(['write_file']), hooks: hooks.runner },
    );

    expect(asked).toHaveLength(0);
    expect(hooks.events).not.toContain('PermissionRequest');
    expect(res.outcome.ok).toBe(true);
  });

  it('PreToolUse 钩子在任何情况下都先跑（连「总是允许」也不能跳过它）', async () => {
    const hooks = recordingHooks();
    const { resolver } = fixedResolver('deny');
    await runTool(writeFileTool as never, { path: 'plain.txt', content: '1' }, ctx(), resolver, {
      alwaysAllow: new Set(['write_file']),
      hooks: hooks.runner,
    });
    expect(hooks.events).toContain('PreToolUse');
  });
});

describe('回答「总是允许」时不该产生隐性放行', () => {
  it('对硬 ask 回答「总是允许」**不会**写入会话白名单（否则普通写操作会被顺带永久放行）', async () => {
    const alwaysAllow = new Set<string>();
    const { resolver } = fixedResolver('allow_always');
    const res = await runTool(
      writeFileTool as never,
      { path: join(root, '.env'), content: 'SECRET=1' },
      ctx(),
      resolver,
      { alwaysAllow },
    );

    expect(res.outcome.ok).toBe(true); // 这一次按用户的选择执行
    expect(alwaysAllow.has('write_file')).toBe(false); // 但不留隐性放行
  });

  it('对软 ask 回答「总是允许」会写入白名单（正常路径）', async () => {
    const alwaysAllow = new Set<string>();
    const { resolver } = fixedResolver('allow_always');
    await runTool(writeFileTool as never, { path: 'plain.txt', content: '1' }, ctx(), resolver, {
      alwaysAllow,
    });
    expect(alwaysAllow.has('write_file')).toBe(true);
  });
});

describe('敏感路径仍然正常落盘（拒绝不是"一律不动"）', () => {
  it('用户明确允许后，敏感路径确实被写入（硬 ask 只是"每次都要问"，不是"不能做"）', async () => {
    const target = join(root, '.env');
    await fsWriteFile(target, 'OLD=1', 'utf8');
    const { resolver, asked } = fixedResolver('allow_once');
    const res = await runTool(writeFileTool as never, { path: target, content: 'NEW=2' }, ctx(), resolver, {
      alwaysAllow: new Set(['write_file']),
    });
    expect(asked).toHaveLength(1);
    expect(res.outcome.ok).toBe(true);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(target, 'utf8')).toBe('NEW=2');
  });
});
