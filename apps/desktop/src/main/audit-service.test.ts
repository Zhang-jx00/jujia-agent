import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GateAuditInfo, PermissionDecision } from '@jujia/agent-core';
import { createAuditLog } from './audit-log';
import { createAuditService, type PolicyHealth } from './audit-service';

/**
 * 审计服务（M4 收尾 · 其二）的接线验收。
 *
 * 这里盯的是三件最容易悄悄错的事：
 * ① 剔密**是不是真的发生在落盘之前**（文件里不能有原文）；
 * ② 命令行参数名**是不是只认工具的声明**（没声明就不许猜）；
 * ③ 规则表的健康度**是不是真的进了账**（读坏了要看得见，T37）。
 */

let dir: string;
const HEALTH: PolicyHealth = { source: 'primary', count: 3, recovered: false };

function info(over: Partial<GateAuditInfo> = {}): GateAuditInfo {
  return {
    toolName: 'run_command',
    kind: 'exec',
    outcome: 'ask',
    asked: true,
    answer: 'allow_once',
    reason: '执行命令，需确认',
    durationMs: 12,
    args: { command: 'echo hi' },
    sessionId: 's-1',
    executed: true,
    commandArg: 'command',
    ...over,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-audit-svc-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function service(health: PolicyHealth = HEALTH) {
  const log = createAuditLog({ dir, clock: () => new Date('2026-10-09T10:00:00.000Z') });
  return {
    log,
    svc: createAuditService({
      log,
      policyHealth: () => health,
      workspaceRoot: () => 'D:/work/demo',
      now: () => new Date('2026-10-09T10:00:00.000Z'),
    }),
  };
}

describe('createAuditService', () => {
  it('命令行进账之前先剔密：磁盘上找不到那串令牌', async () => {
    const { svc } = service();
    await svc.recordTool(
      info({ args: { command: 'curl -H "Authorization: Bearer superSecretTokenValue1234567890"' } }),
    );
    const page = await svc.tail(10);
    expect(page.records[0]?.args.command).toContain('Bearer');
    expect(page.records[0]?.args.command).not.toContain('superSecretTokenValue');
    const raw = JSON.stringify(page.records);
    expect(raw).not.toContain('superSecretTokenValue1234567890');
  });

  it('工具没声明 commandArg 时不去猜 args.command：正文只留长度与指纹', async () => {
    const { svc } = service();
    await svc.recordTool(
      info({
        toolName: 'write_file',
        kind: 'write',
        commandArg: undefined,
        args: { path: 'D:/work/demo/a.md', content: '机密正文机密正文机密正文' },
      }),
    );
    const rec = (await svc.tail(10)).records[0];
    expect(rec?.args.command).toBeUndefined();
    expect(JSON.stringify(rec)).not.toContain('机密正文');
    expect(rec?.args.paths).toEqual(['a.md']);
  });

  it('规则表健康度逐条带上（读坏了以后每条账都能看出那天在按空表跑）', async () => {
    const { svc } = service({ source: 'default', count: 0, recovered: true });
    await svc.recordTool(info());
    const rec = (await svc.tail(10)).records[0];
    expect(rec?.rules).toEqual({ source: 'default', count: 0, degraded: true });
  });

  it('软 ask 被「总是允许」压掉时：账上写"判定是 ask 但没问过"，不许伪装成问过', async () => {
    const { svc } = service();
    await svc.recordTool(
      info({ toolName: 'write_file', kind: 'write', asked: false, answer: undefined, commandArg: undefined }),
    );
    const rec = (await svc.tail(10)).records[0];
    expect(rec?.outcome).toBe('ask');
    expect(rec?.asked).toBe(false);
    expect(rec?.answer).toBeUndefined();
  });

  it('recordGate 记非工具门（下一轮接 git / 打开方式时用同一条出口）', async () => {
    const { svc } = service();
    await svc.recordGate({
      subject: 'git_commit',
      outcome: 'ask',
      asked: true,
      answer: 'deny',
      reason: '提交会写入仓库历史，需人工确认',
      args: { message: '把密钥 ABCDEFGHIJKLMNOPQRST 写进提交信息' },
      sessionId: 'manual',
      executed: false,
    });
    const rec = (await svc.tail(10)).records[0];
    expect(rec?.kind).toBe('gate');
    expect(rec?.executed).toBe(false);
    expect(JSON.stringify(rec)).not.toContain('ABCDEFGHIJKLMNOPQRST');
  });

  it('导出：新路径写得出、已存在的路径拒绝覆盖', async () => {
    const { svc } = service();
    await svc.recordTool(info());
    const dest = join(dir, 'out.jsonl');
    const res = await svc.exportTo(dest);
    expect(res.lines).toBe(1);
    await expect(svc.exportTo(dest)).rejects.toThrow(/已存在/);
  });

  it('tail 带出工作区根（界面要说明"路径是按哪个根化简的"）', async () => {
    const { svc } = service();
    expect((await svc.tail(5)).workspaceRoot).toBe('D:/work/demo');
  });

  /**
   * 防漂移锁：审计的 answer 集合必须**盖住**审批的所有决定。
   * 两个包各写一份枚举是这个项目的老毛病（权限模式那条锁就是为此而设），
   * 这里用同一手法：漏一个值，这轮就红。
   */
  it('AuditAnswer 覆盖 PermissionDecision 的每一个取值', async () => {
    const decisions: PermissionDecision[] = ['allow_once', 'allow_always', 'deny', 'timeout', 'edit'];
    const { svc } = service();
    for (const d of decisions) {
      await svc.recordTool(info({ answer: d }));
    }
    const page = await svc.tail(50);
    expect(page.records.map((r) => r.answer)).toEqual(decisions);
  });

  it('写不进磁盘不抛穿业务，但状态里数得出（审计坏了不该让一次执行跟着死）', async () => {
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'not a dir', 'utf8');
    const log = createAuditLog({ dir: blocker, clock: () => new Date('2026-10-09T10:00:00.000Z') });
    const svc = createAuditService({
      log,
      policyHealth: () => HEALTH,
      workspaceRoot: () => '',
      now: () => new Date('2026-10-09T10:00:00.000Z'),
    });
    await svc.recordTool(info());
    expect((await svc.status()).writeFailures).toBe(1);
  });
});
