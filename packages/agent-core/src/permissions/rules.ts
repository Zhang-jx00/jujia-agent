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
 * 为什么不开命令级 `allow`：`alwaysAllow` 按工具名记，已经等于"以后不再问这个工具"；
 * 再往下开"以后不再问这条命令的前缀"就是让一句话永久放行一段可被拼接的命令行，
 * 那是**权限映射**的改动，需要单独拍板，不在收尾里顺手做（校验层直接拒，见 checkRuleInput）。
 *
 * 「按参数匹配」做到哪一步了（M4 收尾 · 其一，2026-10-09）：
 * 只做了**命令前缀**这一种，且只用于**收紧**（deny / ask）。前提是这里说的那件事已经成立 ——
 * 工具自己声明"哪条参数是命令行"（`ToolDefinition.commandArg`，目前只有 `run_command` 声明了它）。
 * 没声明的工具**一律不参与**前缀匹配：把"这条工具没有命令参数"当成"空命令"去匹配，
 * 就会让一条写来管 `rm` 的规则莫名其妙管到别的工具上 —— 那是假能力，也是误伤。
 *
 * 「命令前缀」怎么比（R47 · T52 收紧，2026-10-21）：
 * 原先比的是**整串字面开头**，于是 `git.exe push` / `"git" push` /
 * `C:\Program Files\Git\cmd\git.exe push` 三种改写形态全都绕得开 ——
 * 用户写下的 `deny git push` 是"不许推送"的承诺，绕得开就等于承诺是假的。
 * 现在比的是**「程序名 + 参数」两段**（见 `commandPrefixMatch`）：
 * 程序名去引号 / 去目录 / 剥可执行扩展名后逐字比，参数按整词比。
 * **方向是收紧**（授权已定，见 `docs/DECISION-SELF-DIRECTED.md`），
 * 所以它只用在 deny / ask 上；`allow` 那一侧连同"放行侧多命中一次就是放行"一起被挡住。
 */

import { containsShellMetachar, programKey, splitCommandLine } from '../commands/argv';

/** 规则动作 */
export type RuleAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  id: string;
  /** 工具名 glob。`*` 任意字符（不含 / 与 \\），`**` 任意字符，`?` 单个非分隔符字符 */
  pattern: string;
  action: RuleAction;
  /** 为什么有这条规则（写下来是为了半年后还看得懂；也会在 UI 里展示） */
  note?: string | undefined;
  /**
   * 命令前缀（**按「程序名 + 参数」两段匹配**，只用于 deny / ask）。
   * 只有声明了 `commandArg` 的工具会看它；`allow` 规则带它会在校验层被拒。
   */
  argPrefix?: string | undefined;
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

/** 导出给契约层做长度一致性锁（见 rule-wire-consistency.test.ts） */
export const MAX_PATTERN_LENGTH = 200;
/** 命令前缀的长度上限：与模式同宽，界面一格输入框就够 */
export const MAX_ARG_PREFIX_LENGTH = 200;
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

/**
 * 命中细节 —— 命中时要能说清"拦的是哪一段"（R47 · T52 收紧）。
 *
 * 为什么要有它：前缀规则从"整串字面开头"改成"程序名 + 参数"两段之后，
 * `deny git push` 拦下的是 `git.exe push` —— 用户在界面上看见的却是 `git push`，
 * 不说清这一段，他没法判断自己写的承诺到底被谁执行了。
 */
export interface CommandPrefixMatch {
  /** 命令行里出现的程序名（原样：可能带引号与路径） */
  rawProgram: string;
  /** 判定时用的程序名（`splitCommandLine` 已去引号；这一层再去目录 / 去可执行扩展名 / 小写） */
  program: string;
  /** 前缀带的参数 */
  prefixArgs: string[];
  /** 命令在扣掉前缀参数之后**还剩下**的参数 */
  restArgs: string[];
}

/**
 * `command` 是不是以 `prefix` 这一段开头 —— **按「程序名 + 参数」两段判**（R47 · T52）。
 *
 * 收紧前的判法是整串字面 `startsWith`，于是三种改写形态全都绕得开：
 * `git.exe push` / `"git" push` / `C:\Program Files\Git\cmd\git.exe push`
 * —— 用户写下的 `deny git push` 承诺的是"不许推送"，绕得开就等于承诺是假的。
 *
 * 现在的判法（三条，方向全是"宁可多命中"）：
 * 1. **程序名按归一化后比** —— 去引号、去目录、剥 `.exe/.com/.cmd/.bat` 这类可执行扩展名、
 *    忽略大小写。**两边都带路径时比整条路径**（只带一边时比文件名），
 *    这样 `deny C:\tools\mytool` 不会去拦 `D:\other\mytool`（那是过度拦截）。
 * 2. **参数按整词比** —— 前缀带的参数必须逐个相同地出现在命令参数的最前面；
 *    `git push` 管得住 `git push --force`，管不住 `git pushx`。
 * 3. **含 shell 组合符一律不算命中**（沿用旧口径）—— `git status; curl evil` 的前缀是
 *    `git status`，但它做的事远不止 `git status`，前缀证明不了整条命令。
 *
 * **这个方向只许用在收紧侧**（deny / ask）：`allow` 方向按规矩不开
 * （`checkRuleInput` 直接拒），而收紧侧"多命中一次"是保守的、
 * 放行侧"多命中一次"就是放行 —— 所以 `matchRules` 里对 `allow` 规则另作处理。
 */
export function commandPrefixMatch(prefix: string, command: string): CommandPrefixMatch | null {
  if (containsShellMetachar(command) || containsShellMetachar(prefix)) return null;
  if (prefix.trim() === '' || command.trim() === '') return null;

  const p = splitCommandLine(prefix);
  const c = splitCommandLine(command);
  if (p.program === '' || c.program === '') return null;

  const pk = programKey(p.program);
  const ck = programKey(c.program);
  const sameProgram = pk.hasPath && ck.hasPath ? pk.full === ck.full : pk.base === ck.base;
  if (!sameProgram) return null;

  // 参数按整词比（大小写与空格数量不参与：同一台机器上 `RM -RF` 与 `rm -rf` 是同一条命令）
  const pArgs = p.args.map((a) => a.toLowerCase());
  const cArgs = c.args.map((a) => a.toLowerCase());
  if (pArgs.length > cArgs.length) return null;
  for (let i = 0; i < pArgs.length; i += 1) {
    if (pArgs[i] !== cArgs[i]) return null;
  }

  return {
    rawProgram: c.program,
    program: ck.base,
    prefixArgs: p.args,
    restArgs: c.args.slice(pArgs.length),
  };
}

/** 是不是命中（只要一个布尔时用它；要说清"拦的是哪一段"时用上面的 `commandPrefixMatch`） */
export function commandPrefixMatches(prefix: string, command: string): boolean {
  return commandPrefixMatch(prefix, command) !== null;
}

/**
 * 前缀那一格是否也命中（没填前缀的老规则恒为 true）。
 *
 * 返回两样东西：**适不适用**与**命中细节** ——
 * 理由文案要靠细节说出"拦的是哪一段"，所以不能只回一个布尔。
 */
function prefixOutcome(
  rule: PermissionRule,
  command: string | undefined,
): { applies: boolean; detail: CommandPrefixMatch | null } {
  const prefix = rule.argPrefix?.trim();
  if (prefix === undefined || prefix === '') return { applies: true, detail: null };
  // 工具没声明命令行参数 → 前缀规则一律不生效。
  // 绝不能把 undefined 当空串去比：那会让"没有命令参数"变成"命令是空的"。
  if (command === undefined) return { applies: false, detail: null };
  const detail = commandPrefixMatch(prefix, command);
  return { applies: detail !== null, detail };
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
 *
 * `command` 是本次调用的命令行文本，**由调用方从工具自己声明的 `commandArg` 里取**
 * （见 policy.ts 的 GateContext.commandArg）。不传就等于"这次没有命令行"：
 * 带前缀的规则一律不命中，不带前缀的规则照常按工具名命中。
 */
export function matchRules(
  rules: ReadonlyArray<PermissionRule>,
  toolName: string,
  command?: string | undefined,
): RuleMatch | null {
  let best: PermissionRule | null = null;
  let bestSeverity = 0;
  let bestDetail: CommandPrefixMatch | null = null;

  // 用 for 而不是 forEach：TypeScript 无法追踪闭包里的赋值，
  // 会把 `best` 窄化成 never（实测 TS2339）
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatches(rule, toolName)) continue;
    const outcome = prefixOutcome(rule, command);
    if (!outcome.applies) continue;
    /**
     * `allow` + 命令前缀这一格**按规矩不存在**（`checkRuleInput` 直接拒收）。
     * 万一真存在（老数据 / 绕过校验层写进存储），它**不放行任何东西** ——
     * 因为收紧判定只许让 deny / ask 命中更多，不许让 allow 命中更多
     * （放行侧"多命中一次"就是放行，那是这条改动最不该碰的一侧）。
     */
    if (rule.action === 'allow' && outcome.detail !== null) continue;
    const level = severity(rule.action);
    if (level > bestSeverity) {
      best = rule;
      bestSeverity = level;
      bestDetail = outcome.detail;
    }
  }

  if (best === null) return null;
  const rule = best;
  const prefix = rule.argPrefix?.trim();
  const prefixPart = prefix ? `（命令前缀：${prefix}）` : '';
  /**
   * 程序名对不上时要说清是"哪一个程序按哪一个名字判的" ——
   * 用户写的是 `git push`，被拦下的是 `git.exe push`，
   * 不说这一句，他看到的就是"我的规则怎么拦了个我没写的东西"。
   */
  const programPart =
    bestDetail !== null && bestDetail.rawProgram.toLowerCase() !== bestDetail.program
      ? `（程序名 ${bestDetail.rawProgram} 按 ${bestDetail.program} 判定）`
      : '';
  const noteSuffix = rule.note ? `（备注：${rule.note}）` : '';
  const actionText = rule.action === 'deny' ? '拒绝' : rule.action === 'ask' ? '必须询问' : '自动放行';
  return {
    rule,
    action: rule.action,
    reason: `命中你的规则「${rule.pattern}」${prefixPart}${programPart} → ${actionText}${noteSuffix}`,
  };
}

/** 校验用户输入的规则（在落盘之前把住） */
export function checkRuleInput(input: {
  pattern: string;
  action: string;
  note?: string | undefined;
  argPrefix?: string | undefined;
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

  const prefix = input.argPrefix?.trim();
  if (prefix !== undefined) {
    if (prefix === '') {
      // 留空 = 不按前缀收紧（界面上不该发出这个请求）；填了空白更不该静默当成没填
      errors.push('命令前缀不能是空白：要么填一段真正的命令开头，要么把这一格留空');
    } else {
      if (prefix.length > MAX_ARG_PREFIX_LENGTH) {
        errors.push(`命令前缀过长（最多 ${MAX_ARG_PREFIX_LENGTH} 字符）`);
      }
      if (containsShellMetachar(prefix)) {
        errors.push('命令前缀不能含 shell 组合符（| & ; < > ` $ 与换行）：前缀只能证明命令从哪开始，证明不了整条命令做什么');
      }
      if (/[*?[\]]/.test(prefix)) {
        errors.push('命令前缀按**字面**匹配，不支持 glob 通配符：写 `*` 只会匹配到一个真叫 * 的字符，那不是你要的语义');
      }
      if (input.action === 'allow') {
        errors.push(
          '命令前缀只能用来收紧（deny / ask）。命令级「以后不再问」等于把权限门按命令拆掉；' +
            '要放行整类工具请写按工具名的 allow 规则，要完全不加判断请用 bypassPermissions 模式',
        );
      }
    }
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
