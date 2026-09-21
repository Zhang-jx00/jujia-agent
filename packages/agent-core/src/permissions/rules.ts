/**
 * 自定义权限规则表（W5c，M15）—— 纯逻辑，可单测。
 *
 * 定位：**策略层的一个输入**，不是另一个权限系统。
 * 用户用「工具名 glob + 动作」表达自己的意图，`decideGate` 在判定时最先看它。
 *
 * 优先级设计（务必按此理解，测试已锁死）：
 * 1. **deny 绝对生效** —— 「绝不碰 X」是承诺，任何模式都不能覆盖它
 *    （包括 bypassPermissions：模式是"我信这个沙箱"，规则是"我不信这个工具"）。
 * 2. **ask 绝对生效** —— 「这个必须问我」同样无条件；它甚至能强到
 *    让**只读**工具也来问（此前只读从不打扰，这是规则表带来的新能力）。
 * 3. **allow 只在会话没有更严格的意图时生效** —— `plan`（只读）与 `dontAsk`
 *    是**会话级**的明确意图，优先于**常设**的规则；否则"开了只读模式却被规则放行了写入"
 *    会让用户以为模式坏了。
 * 4. 同一条规则命中多个动作时取**最严格**的一侧（deny > ask > allow），
 *    与 MCP 工具分级里"自相矛盾取更严格一侧"是同一条原则。
 *
 * **刻意不做**「按参数 glob」（计划里提过）：
 * 参数匹配需要每个工具声明自己的参数语义（哪个参数是路径、哪个是命令），
 * 现在没有任何工具声明过 —— 在那之前做参数匹配，等于把"看起来能配"的东西卖给用户，
 * 实际上它只会匹配到 JSON 字符串，行为完全不可预测。做了就是撒谎。
 */

/** 规则动作 */
export type RuleAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  id: string;
  /** 工具名 glob。`*` 任意字符（不含 / 与 \\），`**` 任意字符，`?` 单个非分隔符字符 */
  pattern: string;
  action: RuleAction;
  /** 为什么有这条规则（写下来是为了半年后还看得懂；也会在 UI 里展示） */
  note?: string | undefined;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 单条规则校验结果 */
export interface RuleCheck {
  ok: boolean;
  errors: string[];
  /** 非致命但必须让 UI 显著提示的点（例如 deny 匹配所有工具） */
  warnings: string[];
}

const MAX_PATTERN_LENGTH = 200;

/**
 * glob → 正则。
 *
 * 语义（业界常规）：
 * - `**` → 任意字符（含路径分隔符）
 * - `*`  → 任意字符，但**不跨** `/` 与 `\`（为将来按路径匹配留好语义）
 * - `?`  → 单个非分隔符字符
 * - 其余字符一律转义 —— 用户输入直接进正则是注入面
 *
 * 转义之后每个量词都是"字符类 + 量词"，不存在嵌套量词，因此**没有 ReDoS 风险**。
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] as string;
    if (ch === '*') {
      // 处理 **（连续两个星号）
      if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/\\\\]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/\\\\]';
      continue;
    }
    source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** 该规则是否命中某个工具名（大小写敏感：工具名是标识符，不是自然语言） */
export function ruleMatches(rule: PermissionRule, toolName: string): boolean {
  if (rule.pattern.trim() === '') return false;
  return globToRegExp(rule.pattern).test(toolName);
}

export interface RuleMatch {
  rule: PermissionRule;
  action: RuleAction;
  /** 给用户看的判定理由（含命中的规则与它的 note） */
  reason: string;
}

function severity(action: RuleAction): number {
  // 数值越大越严格；同类规则之间按列表顺序取第一个
  return action === 'deny' ? 3 : action === 'ask' ? 2 : 1;
}

/**
 * 在启用且命中的规则里选出**生效的那一条**。
 *
 * 跨类取最严格（deny > ask > allow）；同类里取**列表顺序的第一个** ——
 * 这样规则列表在 UI 里的呈现顺序就是它的语义顺序，用户可以从上往下读。
 * 没有命中 → 返回 null（交给模式判定）。
 */
export function matchRules(
  rules: ReadonlyArray<PermissionRule>,
  toolName: string,
): RuleMatch | null {
  let best: PermissionRule | null = null;
  let bestSeverity = 0;

  // 用 for 而不是 forEach：TypeScript 无法追踪闭包里的赋值，
  // 会把 `best` 窄化成 never（实测 TS2339）
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatches(rule, toolName)) continue;
    const level = severity(rule.action);
    if (level > bestSeverity) {
      best = rule;
      bestSeverity = level;
    }
  }

  if (best === null) return null;
  const rule = best;
  const noteSuffix = rule.note ? `（备注：${rule.note}）` : '';
  const actionText = rule.action === 'deny' ? '拒绝' : rule.action === 'ask' ? '必须询问' : '自动放行';
  return {
    rule,
    action: rule.action,
    reason: `命中你的规则「${rule.pattern}」→ ${actionText}${noteSuffix}`,
  };
}

/** 校验用户输入的规则（在落盘之前把住） */
export function checkRuleInput(input: {
  pattern: string;
  action: string;
  note?: string | undefined;
}): RuleCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pattern = input.pattern.trim();

  if (pattern === '') errors.push('匹配模式不能为空');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    errors.push(`匹配模式过长（最多 ${MAX_PATTERN_LENGTH} 字符）`);
  }
  if (/[\r\n]/.test(pattern)) errors.push('匹配模式不能包含换行');

  if (input.action !== 'allow' && input.action !== 'deny' && input.action !== 'ask') {
    errors.push('动作必须是 allow / deny / ask 之一');
  }
  if (input.note !== undefined && input.note.length > 200) {
    errors.push('备注过长（最多 200 字符）');
  }

  // 「deny 一切」是合法但危险的配置：允许保存，但 UI 必须醒目提示，不能悄悄接受
  if (errors.length === 0 && input.action === 'deny' && isDenyAllPattern(pattern)) {
    warnings.push('这条规则会拒绝所有工具（相当于一刀切断全部工具调用）。请确认这是你想要的。');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 该模式是否等于"拒绝所有工具"（UI 用它来给醒目警告，而不是静默接受） */
export function isDenyAllPattern(pattern: string): boolean {
  const re = globToRegExp(pattern.trim());
  return re.test('some_tool') && re.test('另一个完全不同的名字') && re.test('x');
}
