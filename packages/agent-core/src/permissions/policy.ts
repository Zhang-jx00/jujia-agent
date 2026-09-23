import type { ToolKind } from '../tools/types';
import { matchRules, type PermissionRule } from './rules';

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

/**
 * `ask` 分两种（2026-09-23 补）：
 *
 * - **软 ask（`bypassable: true`）**：默认的"写文件要不要做"。用户可以选「本次会话总是允许」把它压掉 ——
 *   因为同一工具的写操作风险差异由**敏感路径**那条硬 ask 兜住。
 * - **硬 ask（`bypassable: false`）**：**任何"总是允许"都压不掉**，必须每次都过人手（或由钩子/规则决定）：
 *   命中高危清单 · 命中用户自己写的 `ask` 规则 · 目标是敏感路径 · **执行类命令**。
 *
 * 为什么执行类也算硬 ask：`alwaysAllow` 是按**工具名**记的，而"总是允许 run_command"等于
 * 把**任意命令**永久放行 —— 那不是省事，那是把权限门拆了。真要全放行请用 `bypassPermissions`
 * 或写一条显式规则，那样至少是**看得见、写下来的决定**。
 *
 * 为什么硬 ask 还要保留钩子：`PermissionRequest` 钩子是用户自己写的审批程序，
 * 它不能被界面上的一个"总是允许"按钮连带废掉。
 */
export type GateDecision =
  | { action: 'allow'; reason: string; risk: RiskLevel }
  | { action: 'ask'; reason: string; risk: RiskLevel; bypassable: boolean }
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
  /**
   * 用户自定义规则（W5c）。**优先于模式**，但三个动作的效力不同：
   * - `deny` / `ask` 绝对生效（连 bypassPermissions 也要让路）；
   * - `allow` 只在本会话没有更严格意图（plan / dontAsk）时生效。
   */
  rules?: ReadonlyArray<PermissionRule>;
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
 * 0. **用户规则**（W5c）：deny / ask 绝对生效；allow 在 plan / dontAsk 下让位于会话意图
 * 1. 只读工具 → 放行（不打扰）
 * 2. 高危清单命中 → 询问（任何模式都问）
 * 3. bypassPermissions → 放行（附风险提示）
 * 4. plan / dontAsk → 拒绝写与执行
 * 5. 敏感目标：即使 acceptEdits 也必须问（按参数分级）
 * 6. acceptEdits 且是工作区内、非敏感的写 → 放行
 * 7. 其余写/执行 → 询问
 *
 * **W10g 起本函数才真正接入执行路径**：此前它只被自己的测试调用，
 * 执行器只按 `tool.kind` 询问 —— 也就是说模式、敏感路径、高危清单在运行时全是死代码。
 * 这个缺陷由复核 010 的接线检查发现并修复。
 */
export function decideGate(ctx: GateContext): GateDecision {
  const target = pathOf(ctx.args);

  // 0) 用户规则：优先于模式（见 GateContext.rules 的说明）
  const matched = ctx.rules ? matchRules(ctx.rules, ctx.toolName) : null;
  if (matched?.action === 'deny') {
    return { action: 'deny', reason: matched.reason, risk: 'high' };
  }
  if (matched?.action === 'ask') {
    // 用户自己写下的 ask 规则：**硬 ask**，不被「总是允许」抑制
    return { action: 'ask', reason: matched.reason, risk: 'high', bypassable: false };
  }
  if (matched?.action === 'allow' && ctx.mode !== 'plan' && ctx.mode !== 'dontAsk') {
    return { action: 'allow', reason: matched.reason, risk: 'low' };
  }

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
      bypassable: false,
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
        bypassable: false,
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
      // 软 ask：同一工具的写操作风险差异由上面那条**敏感路径**硬 ask 兜住
      bypassable: true,
    };
  }
  // 执行类：**硬 ask**。按工具名记住「总是允许」等于放行**任意命令** ——
  // 那不是省事，那是把权限门拆了；真要全放行请用 bypassPermissions 或写一条显式规则。
  return { action: 'ask', reason: '执行命令，需确认', risk: 'high', bypassable: false };
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
