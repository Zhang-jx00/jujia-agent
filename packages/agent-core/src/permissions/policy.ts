import type { ToolKind } from '../tools/types';

/**
 * 权限策略层（W5）。
 *
 * 为什么需要它（2026-09-18 联网核实后的设计调整）：
 * 业界已从「一刀切问/不问」转向**按爆炸半径分级**。核实到的结论（来源见文末）：
 * - 「处处都问」等于没问——审查者会橡皮图章式地点允许（审批疲劳）；
 * - 「一律不问」是事故的来源；
 * - 正确做法：**按参数而非仅按工具名分级**——同一个 `write_file`，
 *   写到工作区内的普通文件可以放行，写到敏感路径必须问；
 * - 只读且可逆的调用（read / list / search）不应打扰用户；
 * - `plan` 模式只读，`dontAsk` 模式「拒绝而不问」，`bypassPermissions` 危险需显式开启。
 *
 * 本模块是**纯函数**：输入模式与调用上下文，输出「放行 / 询问 / 拒绝」，可单测、无副作用。
 */

export type PermissionMode =
  | 'default'
  /** 自动接受工作区内的文件编辑（等价于业界 acceptEdits），exec 仍需询问 */
  | 'acceptEdits'
  /** 只读模式：写与执行一律拒绝 */
  | 'plan'
  /** 拒绝而非询问（锁定环境）；注意这与本项目「不静默自动拒绝」的默认取向相反，需用户显式选择 */
  | 'dontAsk'
  /** 全部放行（危险，仅在沙箱内使用；需要一次显式确认才可开启） */
  | 'bypassPermissions';

export type RiskLevel = 'low' | 'medium' | 'high';

export type GateDecision =
  | { action: 'allow'; reason: string; risk: RiskLevel }
  | { action: 'ask'; reason: string; risk: RiskLevel }
  | { action: 'deny'; reason: string; risk: RiskLevel };

export interface GateContext {
  mode: PermissionMode;
  toolName: string;
  kind: ToolKind;
  /** 已校验的入参（路径均已过 path-guard；此处只看语义风险） */
  args: Record<string, unknown>;
  /** 需要「无论什么模式都要问」的工具名（高危清单，可由用户配置） */
  alwaysAsk?: ReadonlyArray<string>;
  /** 覆盖写入（目标已存在）时为 true；用于把「覆盖」判为更高风险 */
  isOverwrite?: boolean;
}

/** 即使处于 acceptEdits，也不自动放行的敏感路径特征（按参数分级的关键） */
const SENSITIVE_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /(^|[\\/])\.env(\.|$)/i, why: '环境变量文件常含密钥' },
  { re: /(^|[\\/])\.git([\\/]|$)/i, why: '版本库元数据，误改会破坏仓库' },
  { re: /(^|[\\/])(id_rsa|id_ed25519|\.pem|\.key|\.pfx|\.p12)$/i, why: '私钥类文件' },
  { re: /(^|[\\/])(\.npmrc|\.git-credentials|credentials|\.netrc)$/i, why: '凭据文件' },
  { re: /(^|[\\/])(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i, why: '锁文件，改动影响依赖解析' },
  { re: /(^|[\\/])(\.github[\\/]workflows)([\\/]|$)/i, why: 'CI 配置，改动影响流水线与密钥使用' },
];

function pathOf(args: Record<string, unknown>): string | null {
  const p = args['path'];
  return typeof p === 'string' ? p : null;
}

/** 该路径是否属于「必须人工确认」的敏感目标 */
export function sensitiveReason(target: string): string | null {
  for (const { re, why } of SENSITIVE_PATH_PATTERNS) {
    if (re.test(target)) return why;
  }
  return null;
}

/**
 * 分级判定：返回放行 / 询问 / 拒绝。
 *
 * 决策顺序（越靠前的规则越优先，便于用户理解与测试）：
 * 1. 只读工具 → 放行（不打扰）
 * 2. 高危清单命中 → 询问（任何模式都问）
 * 3. bypassPermissions → 放行（附风险提示）
 * 4. plan / dontAsk → 拒绝写与执行
 * 5. acceptEdits 且是工作区内、非敏感的写 → 放行
 * 6. 其余写/执行 → 询问
 */
export function decideGate(ctx: GateContext): GateDecision {
  const target = pathOf(ctx.args);

  // 1) 只读且可逆：不打扰用户
  if (ctx.kind === 'read') {
    return { action: 'allow', reason: '只读操作，不修改任何状态', risk: 'low' };
  }

  // 2) 高危清单：无论模式如何都要人来确认
  if (ctx.alwaysAsk?.includes(ctx.toolName)) {
    return {
      action: 'ask',
      reason: `${ctx.toolName} 在高危清单中，需人工确认`,
      risk: 'high',
    };
  }

  // 3) 显式放行模式
  if (ctx.mode === 'bypassPermissions') {
    return {
      action: 'allow',
      reason: '当前为 bypassPermissions 模式（全部放行），请确认你处于可信沙箱内',
      risk: 'high',
    };
  }

  // 4) 只读类模式：写与执行一律拒绝
  if (ctx.mode === 'plan' || ctx.mode === 'dontAsk') {
    const modeName = ctx.mode === 'plan' ? '计划（只读）' : 'dontAsk（拒绝而不询问）';
    return {
      action: 'deny',
      reason: `当前为${modeName}模式，不允许${ctx.kind === 'write' ? '写入' : '执行命令'}`,
      risk: 'medium',
    };
  }

  // 5) 敏感目标：即使 acceptEdits 也必须问（按参数分级）
  if (target !== null) {
    const why = sensitiveReason(target);
    if (why !== null) {
      return {
        action: 'ask',
        reason: `目标是敏感路径（${why}），需人工确认`,
        risk: 'high',
      };
    }
  }

  if (ctx.mode === 'acceptEdits' && ctx.kind === 'write') {
    return {
      action: 'allow',
      reason: ctx.isOverwrite ? 'acceptEdits 模式：覆盖工作区内文件' : 'acceptEdits 模式：写入工作区内文件',
      risk: ctx.isOverwrite ? 'medium' : 'low',
    };
  }

  // 6) 默认：写与执行都要问
  if (ctx.kind === 'write') {
    return {
      action: 'ask',
      reason: ctx.isOverwrite ? '覆盖已有文件，需确认' : '写入文件，需确认',
      risk: ctx.isOverwrite ? 'medium' : 'low',
    };
  }
  return { action: 'ask', reason: '执行命令，需确认', risk: 'high' };
}

export const MODE_LABEL: Record<PermissionMode, string> = {
  default: '默认（写与执行需确认）',
  acceptEdits: '自动接受工作区内文件编辑',
  plan: '计划（只读）',
  dontAsk: '拒绝而不询问',
  bypassPermissions: '全部放行（危险）',
};

/**
 * 审批疲劳防护（核实到的「engagement gate」思路）：
 * 连续同类询问达到阈值时，提示 UI 引导用户改用**规则**而不是继续逐个点允许。
 * 返回 null 表示无需提示。
 */
export function fatigueHint(consecutiveSameTool: number, toolName: string): string | null {
  if (consecutiveSameTool < 3) return null;
  return `你已连续 ${consecutiveSameTool} 次批准 ${toolName}。若这是常规操作，建议改用「本次会话总是允许」，或切换到 acceptEdits 模式；逐个点允许容易漏看风险。`;
}
