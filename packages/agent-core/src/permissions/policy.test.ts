import { describe, expect, it } from 'vitest';
import { decideGate, sensitiveReason, type GateContext } from './policy';

/**
 * 权限策略的验收重点：
 * - 只读不打扰（否则「处处都问」= 没问）；
 * - **按参数分级**：同一个 write_file，写普通文件与写 .env 结论必须不同；
 * - 模式语义清晰：plan/dontAsk 拒绝、bypassPermissions 放行、acceptEdits 有边界。
 */

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    mode: 'default',
    toolName: 'write_file',
    kind: 'write',
    args: { path: 'src/a.ts', content: 'x' },
    ...over,
  };
}

describe('只读操作不应打扰用户', () => {
  it.each(['read', 'list', 'stat'] as const)('kind=%s → 放行', () => {
    const d = decideGate(ctx({ kind: 'read', toolName: 'read_file' }));
    expect(d.action).toBe('allow');
    expect(d.risk).toBe('low');
  });

  it('只读工具即使在 plan 模式也放行', () => {
    expect(decideGate(ctx({ mode: 'plan', kind: 'read' })).action).toBe('allow');
  });

  it('只读工具即使在 dontAsk 模式也放行（只是不提供询问机会）', () => {
    expect(decideGate(ctx({ mode: 'dontAsk', kind: 'read' })).action).toBe('allow');
  });
});

describe('按参数分级：同一工具、不同目标、不同结论', () => {
  it('default 模式：写普通文件 → 询问', () => {
    expect(decideGate(ctx()).action).toBe('ask');
  });

  it.each([
    ['.env', '环境变量'],
    ['.git/config', '版本库元数据'],
    ['keys/id_rsa', '私钥'],
    ['.npmrc', '凭据文件'],
    ['package-lock.json', '锁文件'],
    ['.github/workflows/ci.yml', 'CI 配置'],
  ])('acceptEdits 模式：写敏感路径 %s 仍必须询问', (path) => {
    const d = decideGate(ctx({ mode: 'acceptEdits', args: { path, content: 'x' } }));
    expect(d.action).toBe('ask');
    expect(d.reason).toContain('敏感');
    expect(d.risk).toBe('high');
  });

  it('acceptEdits 模式：写工作区内普通文件 → 放行', () => {
    const d = decideGate(ctx({ mode: 'acceptEdits', args: { path: 'src/util.ts', content: 'x' } }));
    expect(d.action).toBe('allow');
    expect(d.risk).toBe('low');
  });

  it('覆盖写入的风险等级高于新建', () => {
    const fresh = decideGate(ctx({ mode: 'acceptEdits', isOverwrite: false }));
    const over = decideGate(ctx({ mode: 'acceptEdits', isOverwrite: true }));
    expect(fresh.risk).toBe('low');
    expect(over.risk).toBe('medium');
  });

  it('敏感识别支持 Windows 反斜杠路径', () => {
    expect(sensitiveReason('config\\.env.local')).toContain('环境变量');
    expect(sensitiveReason('sub\\.git\\HEAD')).toContain('版本库');
    expect(sensitiveReason('src\\normal.ts')).toBeNull();
  });
});

describe('模式语义', () => {
  it('plan 模式：写与执行一律拒绝', () => {
    expect(decideGate(ctx({ mode: 'plan' })).action).toBe('deny');
    expect(decideGate(ctx({ mode: 'plan', kind: 'exec', toolName: 'run_command' })).action).toBe(
      'deny',
    );
  });

  it('dontAsk 模式：拒绝而不给询问机会', () => {
    const d = decideGate(ctx({ mode: 'dontAsk' }));
    expect(d.action).toBe('deny');
    expect(d.reason).toContain('dontAsk');
  });

  it('bypassPermissions：放行但如实标注为高风险', () => {
    const d = decideGate(ctx({ mode: 'bypassPermissions' }));
    expect(d.action).toBe('allow');
    expect(d.risk).toBe('high');
    expect(d.reason).toContain('沙箱');
  });

  it('高危清单命中 → 任何模式都要询问（含 acceptEdits）', () => {
    const alwaysAsk = ['run_command'];
    for (const mode of ['default', 'acceptEdits'] as const) {
      const d = decideGate(
        ctx({ mode, toolName: 'run_command', kind: 'exec', alwaysAsk }),
      );
      expect(d.action).toBe('ask');
      expect(d.risk).toBe('high');
    }
  });

  it('高危清单优先于 bypassPermissions（先问再说）', () => {
    const d = decideGate(
      ctx({ mode: 'bypassPermissions', toolName: 'run_command', kind: 'exec', alwaysAsk: ['run_command'] }),
    );
    expect(d.action).toBe('ask');
  });

  it('执行命令默认高风险询问', () => {
    const d = decideGate(ctx({ kind: 'exec', toolName: 'run_command', args: {} }));
    expect(d.action).toBe('ask');
    expect(d.risk).toBe('high');
  });
});

/*
 * 「审批疲劳防护」的两条用例已随该函数一起移除（轨道回归计划 2 · R-04）。
 *
 * 原因：`fatigueHint` **从未被任何生产代码调用** —— 留着函数 + 留着测试，
 * 会让人以为"疲劳防护已经做了"。真实的缓解来自**硬/软 ask 分级**与"只读不打扰"。
 * 若要真正做这个提示（在审批弹窗里显示、main 侧记录连续批准次数），
 * 按 `docs/TRACK-ROADMAP.md` 的 R-04 重新实现并补测试 —— **不要只把函数加回来**。
 */
