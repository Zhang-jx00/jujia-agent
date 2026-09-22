/**
 * 生命周期钩子的类型与契约（W5d）。
 *
 * 设计来源：同类成熟项目（ZCode 等）已把"钩子"收敛成一套稳定契约，我们按同一套做，
 * 不另造一套 —— 但**只有真正需要的部分**，且每条都写清"为什么"。
 *
 * 契约要点（每一条都有对应测试）：
 * 1. **默认禁用**：钩子是给"知道自己要什么"的人用的自动化，默认关。
 * 2. **argv 执行，绝不拼 shell 字符串**：命令与参数里的 shell 元字符一律拒绝
 *    （复用 `commands/argv`，与 MCP 共用同一套规则）。
 * 3. **stdin 收一个 JSON、stdout 回一个 JSON**；**空 stdout = 什么都不做**。
 * 4. **退出码 2 = 显式拒绝**（这是唯一被赋予"阻断"语义的退出码）。
 * 5. 其余失败（超时 / 非 JSON / schema 非法 / 非 2 的非零退出）**记为失败但不阻断**
 *    —— 即 fail-open。理由：钩子是**附加**防线，主权限门仍然照常生效（该问的还是会问）；
 *    把钩子的故障升级成"拒绝一切"，会让一个写坏的钩子把整个应用变成砖。
 *    代价是"钩子没跑成"这件事必须**可见**（diagnostics + UI），不能默默吞掉。
 * 6. **多个钩子给出权限决定时取最严格的一侧**（deny > ask > allow），
 *    与规则表、MCP 工具分级同一条原则。
 */

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export const HOOK_EVENT_LABEL: Record<HookEvent, string> = {
  SessionStart: '会话开始',
  UserPromptSubmit: '用户提交提示词',
  PreToolUse: '工具执行前',
  PermissionRequest: '需要审批时',
  PostToolUse: '工具成功后',
  PostToolUseFailure: '工具失败后',
  Stop: '一轮即将结束',
};

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
export const DEFAULT_HOOK_MAX_OUTPUT_BYTES = 32_768;

/** 传给 hook 进程的输入（stdin 上的唯一一个 JSON） */
export interface HookInput {
  hookEventName: HookEvent;
  sessionId: string;
  /** 工作目录：hook 里要用相对路径时的基准 */
  cwd: string;
  /** 事件负载（工具名/参数/提示词/结果等），matcher 与 hook 都能看到 */
  payload: Record<string, unknown>;
}

export type HookPermissionDecision = 'allow' | 'deny' | 'ask';

/** hook 允许返回的结构（stdout 上的唯一一个 JSON） */
export interface HookOutput {
  /** false = 请求阻止（不同事件语义不同：PreToolUse 是拒绝工具，UserPromptSubmit 是拦下提示词） */
  continue?: boolean;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    /** 追加到模型上下文（可解释性：让模型知道"有人刚提醒了你什么"） */
    additionalContext?: string;
    permissionDecision?: HookPermissionDecision;
    permissionDecisionReason?: string;
    /** 改写工具输入（PreToolUse / PermissionRequest）；**会重新过一遍参数校验** */
    updatedInput?: Record<string, unknown>;
  };
}

export interface HookCommandConfig {
  /** 目前只支持进程钩子（外部命令） */
  type: 'process';
  command: string;
  args?: string[];
  /** 覆盖全局超时 */
  timeoutMs?: number;
}

export interface HookMatcherGroup {
  /** JS 正则字符串；省略 = 匹配该事件的全部输入。匹配目标是"事件相关的那个字符串"（工具名/提示词原文等） */
  matcher?: string;
  hooks: HookCommandConfig[];
}

export interface HookConfig {
  enabled: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  events: Partial<Record<HookEvent, HookMatcherGroup[]>>;
}

export const emptyHookConfig = (): HookConfig => ({
  enabled: false,
  timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
  maxOutputBytes: DEFAULT_HOOK_MAX_OUTPUT_BYTES,
  events: {},
});

export interface HookRunParams {
  event: HookEvent;
  sessionId: string;
  cwd: string;
  payload: Record<string, unknown>;
  /** matcher 的匹配目标（工具名 / 提示词原文 / 会话来源 …） */
  matchTarget: string;
}

export interface HookRunResult {
  /** 事件被显式拒绝（退出码 2 或 continue:false） */
  blocked: boolean;
  reason: string | null;
  /** 依次累积的追加上下文（按钩子执行顺序） */
  additionalContext: string[];
  /** 改写后的工具输入（多个钩子都给时取**最后一个**，并记诊断） */
  updatedInput: Record<string, unknown> | null;
  permissionDecision: HookPermissionDecision | null;
  permissionReason: string | null;
  /** Stop 事件专用：是否要求再走一步 */
  continueTurn: boolean;
  /** 失败与异常（超时/非法输出/非 2 非零退出…）—— 必须可见，不能静默 */
  diagnostics: string[];
  /** 实际启动过的钩子进程数 */
  ranCount: number;
}

export const emptyHookResult = (): HookRunResult => ({
  blocked: false,
  reason: null,
  additionalContext: [],
  updatedInput: null,
  permissionDecision: null,
  permissionReason: null,
  continueTurn: false,
  diagnostics: [],
  ranCount: 0,
});

export interface HookRunner {
  run(params: HookRunParams): Promise<HookRunResult>;
}

/** 什么都不做的运行器：未配置钩子时的默认实现（也让执行器可以永远放心调用） */
export const noopHookRunner: HookRunner = {
  run: async (): Promise<HookRunResult> => emptyHookResult(),
};

export interface HookConfigCheck {
  ok: boolean;
  config: HookConfig | null;
  errors: string[];
}

/**
 * 校验钩子配置。
 * 未知事件名一律报错而不是忽略 —— 拼错的事件名会让人以为"钩子生效了"，其实从没跑过。
 */
export function parseHookConfig(input: unknown): HookConfigCheck {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, config: null, errors: ['hooks 配置必须是对象'] };
  }
  const raw = input as Record<string, unknown>;

  const enabled = raw['enabled'] === true;
  const timeoutMs = typeof raw['timeoutMs'] === 'number' ? raw['timeoutMs'] : DEFAULT_HOOK_TIMEOUT_MS;
  const maxOutputBytes =
    typeof raw['maxOutputBytes'] === 'number' ? raw['maxOutputBytes'] : DEFAULT_HOOK_MAX_OUTPUT_BYTES;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) errors.push('hooks.timeoutMs 必须是正数');
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
    errors.push('hooks.maxOutputBytes 必须是正数');
  }

  const eventsRaw = raw['events'];
  const events: Partial<Record<HookEvent, HookMatcherGroup[]>> = {};
  if (eventsRaw !== undefined) {
    if (typeof eventsRaw !== 'object' || eventsRaw === null || Array.isArray(eventsRaw)) {
      errors.push('hooks.events 必须是对象');
    } else {
      for (const [name, groups] of Object.entries(eventsRaw as Record<string, unknown>)) {
        if (!(HOOK_EVENTS as readonly string[]).includes(name)) {
          errors.push(`未知的钩子事件名：${name}（可用：${HOOK_EVENTS.join(' / ')}）`);
          continue;
        }
        if (!Array.isArray(groups)) {
          errors.push(`hooks.events.${name} 必须是数组`);
          continue;
        }
        const parsedGroups: HookMatcherGroup[] = [];
        for (const [gi, g] of groups.entries()) {
          if (typeof g !== 'object' || g === null) {
            errors.push(`hooks.events.${name}[${gi}] 必须是对象`);
            continue;
          }
          const group = g as Record<string, unknown>;
          const matcher = group['matcher'];
          if (matcher !== undefined && typeof matcher !== 'string') {
            errors.push(`hooks.events.${name}[${gi}].matcher 必须是字符串`);
          }
          if (typeof matcher === 'string' && matcher !== '') {
            try {
              new RegExp(matcher);
            } catch {
              errors.push(`hooks.events.${name}[${gi}].matcher 不是合法正则：${matcher}`);
            }
          }
          const hooksRaw = group['hooks'];
          if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
            errors.push(`hooks.events.${name}[${gi}].hooks 必须是非空数组`);
            continue;
          }
          const hooks: HookCommandConfig[] = [];
          for (const [hi, h] of hooksRaw.entries()) {
            if (typeof h !== 'object' || h === null) {
              errors.push(`hooks.events.${name}[${gi}].hooks[${hi}] 必须是对象`);
              continue;
            }
            const hook = h as Record<string, unknown>;
            if (hook['type'] !== 'process') {
              errors.push(`hooks.events.${name}[${gi}].hooks[${hi}].type 目前只支持 "process"`);
            }
            if (typeof hook['command'] !== 'string' || hook['command'].trim() === '') {
              errors.push(`hooks.events.${name}[${gi}].hooks[${hi}].command 必须是非空字符串`);
            }
            const args = hook['args'];
            if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== 'string'))) {
              errors.push(`hooks.events.${name}[${gi}].hooks[${hi}].args 必须是字符串数组`);
            }
            if (hook['timeoutMs'] !== undefined) {
              const t = hook['timeoutMs'];
              if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
                errors.push(`hooks.events.${name}[${gi}].hooks[${hi}].timeoutMs 必须是正数`);
              }
            }
            hooks.push({
              type: 'process',
              command: typeof hook['command'] === 'string' ? hook['command'] : '',
              ...(Array.isArray(args) ? { args: args as string[] } : {}),
              ...(typeof hook['timeoutMs'] === 'number' ? { timeoutMs: hook['timeoutMs'] } : {}),
            });
          }
          parsedGroups.push({
            ...(typeof matcher === 'string' ? { matcher } : {}),
            hooks,
          });
        }
        events[name as HookEvent] = parsedGroups;
      }
    }
  }

  if (errors.length > 0) return { ok: false, config: null, errors };
  return { ok: true, config: { enabled, timeoutMs, maxOutputBytes, events }, errors: [] };
}
