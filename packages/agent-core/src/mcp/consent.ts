/**
 * MCP 连接同意与工具准入（W10c）—— 纯逻辑，可单测。
 *
 * 为什么单独成层：**接入外部 MCP 服务端等于把第三方能力接进你的机器**。
 * 因此本项目要求：接入前必须**用户明确同意**，且同意的粒度到"工具"而不是"服务端"。
 * 这一层负责把"要批准什么"整理成结构化清单给 UI，并给出**风险提示**（确定性规则，不交给模型）。
 *
 * 设计原则（与 docs/PRODUCT-GOAL.md 一致）：
 * - 权限判定用确定性规则；
 * - **默认不放行**：没有明确同意就没有任何工具可用；
 * - 风险要**说人话**并展示原始命令，不替用户做判断、也不淡化风险。
 */

import { buildServerCommand, type McpServerConfig, type McpToolProfile } from './mcp';

/** 单项风险提示 */
export interface RiskWarning {
  /** 机器可读的类别，便于 UI 分类展示 */
  code: string;
  /** 面向用户的一句话说明 */
  message: string;
}

/** 给 UI 的完整批准计划 */
export interface ConnectionApprovalPlan {
  serverId: string;
  serverName: string;
  /** **将实际执行的命令**（已做平台适配），逐字展示给用户 */
  commandLine: string;
  /** 环境变量名清单（只列名，不列值 —— 避免密钥出现在 UI 与日志里） */
  envKeys: string[];
  toolCount: number;
  /** 需要每次询问的工具数（exec 类） */
  alwaysAskCount: number;
  /** 只读工具数（仍会走权限门，但可归入较低风险） */
  readOnlyCount: number;
  tools: Array<{
    qualifiedName: string;
    rawName: string;
    kind: McpToolProfile['kind'];
    kindReason: string;
    description: string;
  }>;
  warnings: RiskWarning[];
  /** 是否建议用户先看风险再决定（有中高风险项时为 true） */
  needsExtraAttention: boolean;
}

/** 用户的选择 */
export type ApprovalChoice =
  | { action: 'deny' }
  | { action: 'approve_all' }
  /** 只批准指定工具（qualifiedName）；其余一律不可用 */
  | { action: 'approve_partial'; toolNames: string[] };

export interface ApprovalOutcome {
  approved: boolean;
  /** 本次批准后**实际可用**的工具（未批准的会被彻底排除，不是"隐藏"） */
  enabledTools: string[];
  /** 拒绝的原因（用于 UI 与日志） */
  note: string;
}

/**
 * 把命令行拼成可展示的字符串。
 * 注意：这里**只用于展示**，真正的 spawn 用 buildServerCommand 返回的数组（不做 shell 拼接）。
 * 含空格或特殊字符的参数加引号，避免用户误读。
 */
export function toDisplayCommandLine(config: McpServerConfig, platform?: NodeJS.Platform): string {
  const spec = buildServerCommand(config, platform);
  const quote = (s: string): string => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return [spec.file, ...spec.args].map(quote).join(' ');
}

/**
 * 检测服务端配置里的风险点。
 * 规则都是**确定性**的，且每条都给"人话"解释 —— 目的是让用户看得懂，而不是吓唬或淡化。
 */
export function detectRisks(config: McpServerConfig): RiskWarning[] {
  const out: RiskWarning[] = [];
  const args = config.args.join(' ');
  const cmd = `${config.command} ${args}`;

  // npx -y / npx --yes：跳过确认直接下载并执行远端包 —— 供应链风险
  if (/^npx$/i.test(config.command) && /(^|\s)(-y|--yes)(\s|$)/.test(args)) {
    out.push({
      code: 'npx-auto-install',
      message:
        '该命令使用 npx 的自动确认参数：会直接下载并执行远端的包。' +
        '如果这个包被替换或投毒，你的机器会直接执行它。请确认包名是你信任的。',
    });
  }
  // 未固定版本：'pkg' vs 'pkg@1.2.3'
  if (/@latest(\s|$)/.test(args) || /\bnpx\s+(-y\s+)?@?[\w./-]+(\s|$)/.test(cmd)) {
    out.push({
      code: 'unpinned-version',
      message: '命令未锁定版本：每次启动可能拿到不同版本。建议改成固定版本（如 pkg@1.2.3）以便复现与审计。',
    });
  }
  // 明显可写的能力信号（仅作提示，真正判定仍由权限门按参数做）
  if (/(^|\s)(-[rw]\s|--write|--allow-write|--root)/i.test(args)) {
    out.push({
      code: 'write-capable',
      message: '参数表明该服务端可能具备写入能力；相关工具的调用仍会逐次向你确认。',
    });
  }
  // 引用了工作区之外的绝对路径
  const outside = config.args.filter((a) => /^[A-Za-z]:[\\/]|\//.test(a));
  if (outside.length > 0) {
    out.push({
      code: 'absolute-path',
      message: `命令里包含绝对路径（${outside.join(', ')}）：请确认它指向的目录是你允许该服务端访问的范围。`,
    });
  }
  // env 里疑似放密钥
  const envKeys = Object.keys(config.env ?? {});
  const suspicious = envKeys.filter((k) => /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(k));
  if (suspicious.length > 0) {
    out.push({
      code: 'secret-in-env',
      message:
        `环境变量 ${suspicious.join(', ')} 看起来是密钥。本项目约定密钥不进渲染层、不进模型上下文，` +
        '请确认你真的要把它们交给这个第三方进程。',
    });
  }
  return out;
}

/** 汇总成给 UI 的批准计划 */
export function planConnectionApproval(
  config: McpServerConfig,
  profiles: readonly McpToolProfile[],
  platform?: NodeJS.Platform,
): ConnectionApprovalPlan {
  const warnings = detectRisks(config);
  const tools = profiles.map((p) => ({
    qualifiedName: p.qualifiedName,
    rawName: p.rawName,
    kind: p.kind,
    kindReason: p.kindReason,
    description: p.description,
  }));
  const alwaysAskCount = tools.filter((t) => t.kind === 'exec').length;
  const readOnlyCount = tools.filter((t) => t.kind === 'read').length;
  /**
   * T53：「只读」这一档是**服务端自述**的，批准之前必须说出口。
   *
   * 判据链：`annotations.readOnlyHint === true` → `kind:'read'`（`mcp.ts`）→ 门直接放行（`policy.ts`）；
   * 而 MCP 的参数是任意 JSON 原样透传，本机的敏感路径表只认 `path` 一个键 ——
   * 第三方自称只读，它那个叫 `file_path` 的参数就永远碰不到那张表。
   *
   * 这里**只说不改**：收紧这一档要动的是"外部声明算不算数"这条信任边界（**停牌①**，等所有者定）。
   * 在定下来之前，把这句话放在批准界面上，比让"只读"两个字看起来像一道本机守卫诚实。
   */
  if (readOnlyCount > 0) {
    warnings.push({
      code: 'read-only-self-reported',
      message:
        `其中 ${readOnlyCount} 个工具的「只读」是**服务端自述**的（它自己声明，不是本机判出来的）：` +
        '走到这一档的调用**不再问你**就直接执行，而它的参数是任意 JSON —— ' +
        '第三方只要自称只读，就能用一个本机叫不出名字的路径参数读它想读的任何东西。' +
        '这不是规则页能收紧的档位（收紧它属待决策项）；不放心的话请只勾选执行类以外你确实要用的那几个。',
    });
  }
  return {
    serverId: config.id,
    serverName: config.name,
    commandLine: toDisplayCommandLine(config, platform),
    envKeys: Object.keys(config.env ?? {}),
    toolCount: tools.length,
    alwaysAskCount,
    readOnlyCount,
    tools,
    warnings,
    needsExtraAttention: warnings.some(
      (w) =>
        w.code === 'npx-auto-install' ||
        w.code === 'secret-in-env' ||
        // 只有"自述只读"这一件事时也标成需要先看风险：那正是最容易被跳过去的一格（T53）
        w.code === 'read-only-self-reported' ||
        alwaysAskCount > 0,
    ),
  };
}

/**
 * 按用户选择算出**实际可用**的工具集合。
 *
 * 关键约定：
 * - `deny` → 没有任何工具可用（**不是"暂不可用"**，而是彻底不接入）；
 * - `approve_partial` 里给了不存在的工具名 → **忽略它**，而不是把不存在的名字放进可用集合
 *   （否则会出现"批准了一个不存在的工具"这种假记录，日后审计会被误导）。
 */
export function applyApproval(
  plan: ConnectionApprovalPlan,
  choice: ApprovalChoice,
): ApprovalOutcome {
  const all = plan.tools.map((t) => t.qualifiedName);

  if (choice.action === 'deny') {
    return { approved: false, enabledTools: [], note: '你拒绝了接入该 MCP 服务端，未启用任何工具' };
  }
  if (choice.action === 'approve_all') {
    return {
      approved: true,
      enabledTools: all,
      note: `已接入 ${plan.serverName}，启用全部 ${all.length} 个工具（exec 类仍会逐次询问）`,
    };
  }

  const known = new Set(all);
  const wanted = new Set(choice.toolNames.filter((n) => known.has(n)));
  const ignored = choice.toolNames.filter((n) => !known.has(n));
  const enabled = all.filter((n) => wanted.has(n));

  if (enabled.length === 0) {
    return {
      approved: false,
      enabledTools: [],
      note: '你未启用任何工具，因此该服务端不会被接入',
    };
  }
  return {
    approved: true,
    enabledTools: enabled,
    note:
      `已接入 ${plan.serverName}，仅启用 ${enabled.length}/${all.length} 个工具` +
      (ignored.length > 0 ? `（忽略了 ${ignored.length} 个不存在的工具名）` : ''),
  };
}

/** 判断某个工具当前是否可用（未批准的一律不可用） */
export function isToolEnabled(outcome: ApprovalOutcome, qualifiedName: string): boolean {
  return outcome.approved && outcome.enabledTools.includes(qualifiedName);
}
