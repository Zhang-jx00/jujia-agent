import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProcessHookRunner } from './runner';
import { DEFAULT_HOOK_MAX_OUTPUT_BYTES, emptyHookConfig, parseHookConfig } from './types';
import type { HookConfig } from './types';

/**
 * 钩子运行器测试 —— **全部用真子进程**。
 *
 * 为什么不用假 spawn：钩子的风险面都在"进程真的起来了吗 / 超时真的杀了吗 /
 * 输出真的读到了吗"这些地方，假实现测不出这些。与 MCP 侧同一套证据标准。
 *
 * 注意：命令与参数里不能出现 shell 元字符（含 `;`），所以脚本一律落成文件再执行 ——
 * 这也是我们给用户推荐的写法（`node script.mjs`），而不是 `node -e "…"`。
 */

let dir = '';
const script = (name: string, code: string): string => {
  const p = join(dir, name);
  writeFileSync(p, code, 'utf8');
  return p;
};

const SCRIPTS: Record<string, string> = {
  'context.mjs': `
    let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{
      const i=JSON.parse(b);
      process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:i.hookEventName,additionalContext:'ctx-'+i.hookEventName}}) + '\\n');
    });`,
  'echo-input.mjs': `
    let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{
      const i=JSON.parse(b);
      process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:i.hookEventName,additionalContext:JSON.stringify({sid:i.sessionId,cwd:i.cwd,payload:i.payload})}}) + '\\n');
    });`,
  'deny-exit2.mjs': `
    process.stdout.write(JSON.stringify({reason:'被钩子拒绝：这个工具不许用'}));
    process.exit(2);`,
  'deny-continue-false.mjs': `
    process.stdout.write(JSON.stringify({continue:false,reason:'钩子拦下了提示词'}));`,
  'fail-exit1.mjs': `process.stdout.write('boom');process.exit(1);`,
  'bad-json.mjs': `process.stdout.write('not a json at all');`,
  'empty.mjs': `process.exit(0);`,
  'sleep.mjs': `setTimeout(()=>{},60000);`,
  'rewrite.mjs': `
    let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{
      process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:JSON.parse(b).hookEventName,updatedInput:{path:'hooked.txt'}}}) + '\\n');
    });`,
  'perm-deny.mjs': `
    process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'策略程序说不'}}));`,
  'perm-allow.mjs': `
    process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'allow'}}));`,
  'perm-ask.mjs': `
    process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'ask'}}));`,
  'big.mjs': `process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:'x'.repeat(50000)}}));`,
  'stderr.mjs': `process.stderr.write('钩子的日志行');process.exit(0);`,
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'jujia-hooks-'));
  for (const [name, code] of Object.entries(SCRIPTS)) script(name, code);
});

afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

/** 构造"事件 → 单个钩子脚本"的配置 */
function configWith(event: string, file: string, over: Partial<HookConfig> = {}): HookConfig {
  const groups = [{ hooks: [{ type: 'process' as const, command: process.execPath, args: [join(dir, file)] }] }];
  return {
    ...emptyHookConfig(),
    enabled: true,
    timeoutMs: 5_000,
    events: { [event]: groups } as HookConfig['events'],
    ...over,
  };
}

const runnerFor = (config: HookConfig) => createProcessHookRunner({ getConfig: () => config });
const params = (event: string) => ({
  event: event as never,
  sessionId: 's1',
  cwd: dir,
  payload: { toolName: 'write_file' },
  matchTarget: 'write_file',
});

describe('钩子引擎（真子进程）', () => {
  it('默认禁用：enabled=false 时一个进程都不启动', async () => {
    const runner = runnerFor({ ...configWith('PreToolUse', 'context.mjs'), enabled: false });
    const res = await runner.run(params('PreToolUse'));
    expect(res.ranCount).toBe(0);
    expect(res.additionalContext).toEqual([]);
  });

  it('正常返回：additionalContext 被收集，且输入 JSON 里带上事件/会话/工作目录/负载', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'echo-input.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.ranCount).toBe(1);
    const payload = JSON.parse(res.additionalContext[0] ?? '{}');
    expect(payload.sid).toBe('s1');
    expect(payload.cwd).toBe(dir);
    expect(payload.payload).toEqual({ toolName: 'write_file' });
  });

  it('退出码 2 = 显式拒绝，并带出钩子给的理由', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'deny-exit2.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain('这个工具不许用');
  });

  it('continue:false 同样视为阻止（与退出码 2 同义的既有语义）', async () => {
    const runner = runnerFor(configWith('UserPromptSubmit', 'deny-continue-false.mjs'));
    const res = await runner.run(params('UserPromptSubmit'));
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain('提示词');
  });

  it('退出码 1（非 2）**不阻断**，只记诊断 —— 写坏的钩子不能把应用变成砖', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'fail-exit1.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.blocked).toBe(false);
    expect(res.diagnostics.join('|')).toContain('不视为拒绝');
    expect(res.ranCount).toBe(1);
  });

  it('stdout 不是合法 JSON → 不阻断，记诊断', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'bad-json.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.blocked).toBe(false);
    expect(res.diagnostics.join('|')).toContain('不是合法 JSON');
  });

  it('空 stdout = 什么都不做（合法用法：只产生副作用）', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'empty.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.blocked).toBe(false);
    expect(res.additionalContext).toEqual([]);
    expect(res.diagnostics).toEqual([]);
  });

  it('超时：进程被真的杀掉，且**明确说明本次钩子没生效**（不是拒绝）', async () => {
    const runner = runnerFor(
      configWith('PreToolUse', 'sleep.mjs', { timeoutMs: 400 }),
    );
    const started = Date.now();
    const res = await runner.run(params('PreToolUse'));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.blocked).toBe(false);
    expect(res.diagnostics.join('|')).toContain('超时');
    expect(res.diagnostics.join('|')).toContain('没有生效');
  });

  it('改写工具输入：updatedInput 被带出来', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'rewrite.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.updatedInput).toEqual({ path: 'hooked.txt' });
  });

  it('多个钩子给不同权限决定 → 取最严格一侧（deny > ask > allow）', async () => {
    const cfg: HookConfig = {
      ...emptyHookConfig(),
      enabled: true,
      events: {
        PermissionRequest: [
          {
            hooks: [
              { type: 'process', command: process.execPath, args: [join(dir, 'perm-allow.mjs')] },
              { type: 'process', command: process.execPath, args: [join(dir, 'perm-ask.mjs')] },
              { type: 'process', command: process.execPath, args: [join(dir, 'perm-deny.mjs')] },
            ],
          },
        ],
      },
    };
    const res = await runnerFor(cfg).run(params('PermissionRequest'));
    expect(res.permissionDecision).toBe('deny');
    expect(res.permissionReason).toContain('策略程序说不');
    expect(res.ranCount).toBe(3);
  });

  it('matcher 只让命中的组执行；未命中的组一个进程都不起', async () => {
    const hit: HookConfig = {
      ...emptyHookConfig(),
      enabled: true,
      events: {
        PreToolUse: [
          { matcher: '^write_', hooks: [{ type: 'process', command: process.execPath, args: [join(dir, 'context.mjs')] }] },
        ],
      },
    };
    expect((await runnerFor(hit).run(params('PreToolUse'))).ranCount).toBe(1);

    const miss = params('PreToolUse');
    miss.matchTarget = 'read_file';
    expect((await runnerFor(hit).run(miss)).ranCount).toBe(0);
  });

  it('被拒绝后短路：后面的钩子不再执行（拒绝之后再产生副作用没意义）', async () => {
    const cfg: HookConfig = {
      ...emptyHookConfig(),
      enabled: true,
      events: {
        PreToolUse: [
          {
            hooks: [
              { type: 'process', command: process.execPath, args: [join(dir, 'deny-exit2.mjs')] },
              { type: 'process', command: process.execPath, args: [join(dir, 'context.mjs')] },
            ],
          },
        ],
      },
    };
    const res = await runnerFor(cfg).run(params('PreToolUse'));
    expect(res.blocked).toBe(true);
    expect(res.ranCount).toBe(1);
  });

  it('含 shell 元字符的命令直接拒绝，且**不启动任何进程**', async () => {
    const cfg: HookConfig = {
      ...emptyHookConfig(),
      enabled: true,
      events: {
        PreToolUse: [{ hooks: [{ type: 'process', command: 'node', args: ['-e', 'x; rm -rf /'] }] }],
      },
    };
    const res = await runnerFor(cfg).run(params('PreToolUse'));
    expect(res.ranCount).toBe(0);
    expect(res.diagnostics.join('|')).toContain('shell 元字符');
  });

  it('输出超过上限会截断并记诊断（不把内存吃光、也不静默丢失）', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'big.mjs', { maxOutputBytes: 1_000 }));
    const res = await runner.run(params('PreToolUse'));
    expect(res.diagnostics.join('|')).toContain('超过');
    expect(res.diagnostics.join('|')).toContain('截断');
  });

  it('stderr 会被带进诊断（钩子自己的日志在出问题时最有用）', async () => {
    const runner = runnerFor(configWith('PreToolUse', 'stderr.mjs'));
    const res = await runner.run(params('PreToolUse'));
    expect(res.diagnostics.join('|')).toContain('钩子的日志行');
  });

  it('配置每次现取：改了配置立刻生效（不做缓存）', async () => {
    let current = configWith('PreToolUse', 'context.mjs');
    const runner = createProcessHookRunner({ getConfig: () => current });
    expect((await runner.run(params('PreToolUse'))).ranCount).toBe(1);
    current = { ...current, enabled: false };
    expect((await runner.run(params('PreToolUse'))).ranCount).toBe(0);
  });
});

describe('钩子配置校验', () => {
  it('合法配置解析出默认值', () => {
    const check = parseHookConfig({
      enabled: true,
      events: {
        PreToolUse: [{ matcher: '^write_', hooks: [{ type: 'process', command: 'node', args: ['a.mjs'] }] }],
      },
    });
    expect(check.ok).toBe(true);
    expect(check.config?.timeoutMs).toBe(60_000);
    expect(check.config?.maxOutputBytes).toBe(DEFAULT_HOOK_MAX_OUTPUT_BYTES);
    expect(check.config?.events.PreToolUse).toHaveLength(1);
  });

  it('拼错的事件名会报错而不是被忽略（否则用户以为钩子生效了）', () => {
    const check = parseHookConfig({
      enabled: true,
      events: { PretoolUse: [{ hooks: [{ type: 'process', command: 'node' }] }] },
    });
    expect(check.ok).toBe(false);
    expect(check.errors.join('|')).toContain('未知的钩子事件名');
  });

  it('非法 matcher 正则、非 process 类型、空 command、坏 timeout 都被拒绝', () => {
    expect(parseHookConfig({ enabled: true, events: { Stop: [{ matcher: '([', hooks: [{ type: 'process', command: 'node' }] }] } }).ok).toBe(false);
    expect(parseHookConfig({ enabled: true, events: { Stop: [{ hooks: [{ type: 'http', command: 'node' }] }] } }).ok).toBe(false);
    expect(parseHookConfig({ enabled: true, events: { Stop: [{ hooks: [{ type: 'process', command: '   ' }] }] } }).ok).toBe(false);
    expect(parseHookConfig({ enabled: true, timeoutMs: -1, events: {} }).ok).toBe(false);
  });

  it('缺省 enabled 视为关闭（默认禁用）', () => {
    const check = parseHookConfig({ events: {} });
    expect(check.ok).toBe(true);
    expect(check.config?.enabled).toBe(false);
  });
});
