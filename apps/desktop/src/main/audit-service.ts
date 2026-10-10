import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeRecord,
  summarizeArgs,
  type ArgSummary,
  type AuditAnswer,
  type GateAuditInfo,
} from '@jujia/agent-core';
import { createAuditLog, type AuditLog, type AuditPage, type AuditStatus } from './audit-log';
import { getDataRoot } from './paths';

/**
 * 执行审计服务（M4 收尾 · 其二）。
 *
 * 它是"判定事实"与"磁盘上那本账"之间**唯一的一段距离**：
 * - 剔密在这里做（`summarizeArgs`），**在落盘之前** —— 一旦原文进了文件就收不回来；
 * - 判定内容由执行器 / 各权限门交出来（它们各自只有一处出口），服务不再重新推导；
 * - 写失败不阻断做事，但状态里数得出来（见 `status()` 与界面上那句实话）。
 *
 * **本轮覆盖范围（如实）**：工具调用（内置 / MCP / 技能 / 画布 / 手动执行）。
 * git 提交与推送、打开外部程序、改钩子配置这三个**非工具门**尚未接入（下一轮）——
 * 界面上必须把这句话写出来，不能让一份只记了一半的账看起来像全账。
 */

export interface PolicyHealth {
  source: 'primary' | 'backup' | 'default';
  count: number;
  recovered: boolean;
}

export interface AuditGateInput {
  /** 非工具门的虚拟 subject（`git_commit` / `open_with_browser` / `hooks_modify`） */
  subject: string;
  outcome: 'allow' | 'ask' | 'deny';
  asked: boolean;
  answer?: AuditAnswer | undefined;
  reason: string;
  args: unknown;
  sessionId: string;
  durationMs?: number | undefined;
  /** 这件事做没做成（deny = 没做） */
  executed: boolean;
}

export interface AuditService {
  recordTool(info: GateAuditInfo): Promise<void>;
  recordGate(input: AuditGateInput): Promise<void>;
  tail(limit: number): Promise<AuditPage & { workspaceRoot: string }>;
  status(): Promise<AuditStatus>;
  /** 导出：目标路径由调用方（对话框）决定；已存在则拒。返回去了多少行 */
  exportTo(destPath: string): Promise<{ lines: number; file: string }>;
  /** 审计目录（测试与对话框要用） */
  dir(): string;
}

export interface AuditServiceDeps {
  log?: AuditLog;
  /** 覆盖审计目录（测试用；不给就用 `getDataRoot()/audit`） */
  dir?: string;
  /** 每次记录时现取：规则表这次是从哪一档读出来的（T37 要在账上看得见） */
  policyHealth: () => PolicyHealth;
  /** 当前工作区根（路径摘要的相对基准；没选工作区就给空串） */
  workspaceRoot: () => string;
  /** 哪个参数是命令行文本（工具的 `commandArg` 声明；执行器已经把它放进 info 里） */
  now?: () => Date;
}

const AUDIT_DIR_NAME = 'audit';

export function createAuditService(deps: AuditServiceDeps): AuditService {
  // **懒取**：`getDataRoot()` 要碰 electron 的 app，模块加载期就调用会让单元测试直接崩，
  // 也会把"审计目录"钉在进程启动那一刻（配置改数据根之后不该继续往旧地方写）。
  let cachedDir: string | undefined;
  const dirOf = (): string => (cachedDir ??= deps.dir ?? join(getDataRoot(), AUDIT_DIR_NAME));
  let cachedLog: AuditLog | undefined = deps.log;
  const log = (): AuditLog => (cachedLog ??= createAuditLog({ dir: dirOf(), clock: deps.now ?? (() => new Date()) }));

  const summarize = (args: unknown, commandKey?: string): ArgSummary =>
    summarizeArgs(args, {
      ...(commandKey !== undefined && commandKey !== '' ? { commandKey } : {}),
      workspaceRoot: deps.workspaceRoot(),
    });

  return {
    dir: dirOf,

    async recordTool(info) {
      // 命令行的可读形态只在工具**自己声明了** commandArg 时才有 ——
      // 没声明就去猜 `args.command`，等于策略层替工具编参数语义（见 rules.ts 头部）
      const commandKey = info.commandArg;
      await log().append(
        makeRecord({
          clock: new Date().toISOString(),
          sessionId: info.sessionId,
          subject: info.toolName,
          kind: info.kind,
          outcome: info.outcome,
          executed: info.executed,
          asked: info.asked,
          ...(info.answer !== undefined ? { answer: info.answer } : {}),
          ...(info.bypassable !== undefined ? { bypassable: info.bypassable } : {}),
          durationMs: info.durationMs,
          reason: info.reason,
          args: summarize(info.args, commandKey),
          rules: deps.policyHealth(),
        }),
      );
    },

    async recordGate(input) {
      await log().append(
        makeRecord({
          clock: new Date().toISOString(),
          sessionId: input.sessionId,
          subject: input.subject,
          kind: 'gate',
          outcome: input.outcome,
          executed: input.executed,
          asked: input.asked,
          ...(input.answer !== undefined ? { answer: input.answer } : {}),
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
          reason: input.reason,
          args: summarize(input.args),
          rules: deps.policyHealth(),
        }),
      );
    },

    async tail(limit) {
      const page = await log().tail(limit);
      return { ...page, workspaceRoot: deps.workspaceRoot() };
    },

    status: () => log().status(),

    async exportTo(destPath) {
      await mkdir(destPath.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
      return log().exportTo(destPath);
    },
  };
}
