import { decideGate, type GateDecision, type PermissionMode, type PermissionRule } from '@jujia/agent-core';

/**
 * 钩子配置写入的权限档（外部审查 T4 的**唯一**判档处）。
 *
 * 为什么这条必须有：钩子配置里写的是"将来要执行的命令"，而钩子子进程
 * **不过权限门**（它是用户自己写的审批程序，本来就在门的外侧）。
 * 于是 `hooks:set` 这条通道本身就成了"绕过所有门的写盘口" ——
 * 渲染层一旦被注入（网页正文、工具结果、记忆里的话术），
 * 一次 `hooks:set` 就等于在你自己的宿主环境里装了一个持久后门：
 * 配置落盘，重启还在，每次工具调用都会执行它。
 *
 * 判档口径：
 * - 走的是与工具执行、git 动作**同一个** `decideGate`，不搞第二套权限语义；
 * - 但这里的 ask 一律**硬**（`bypassable: false`）：一次"总是允许"换来的是
 *   **长期**放行任意命令，那不是省事，那是把权限门拆了；
 * - 用户自己写的 `allow` 规则与 `bypassPermissions` 仍能放行 —— 那两条是
 *   引擎里既有的"看得见、写下来"的决定，在这里偷偷推翻反而不一致（同 git-gate）。
 */

/** 权限规则表里这条动作的名字（用户可以对它写 allow / deny / ask） */
export const HOOKS_MODIFY_TOOL = 'hooks:modify';

/**
 * `acceptEdits` 的字面意思是"工作区内的**文件编辑**自动放行"，**不包括改钩子配置**：
 * 后者不是编辑一下，而是"以后每次工具调用都要以宿主环境执行这段命令"。
 * 所以这条动作在该模式下降回 `default`（照样要问）—— 与 `git-gate` 对 commit 的处理同一口径。
 *
 * 刻意**不降**两类"看得见、写下来"的决定：用户自己写的 allow 规则、以及 `bypassPermissions`。
 */
function modeForWrite(mode: PermissionMode): PermissionMode {
  return mode === 'acceptEdits' ? 'default' : mode;
}

/**
 * 判档：改钩子配置按"写"来判（它确实改状态），拿到 ask 之后把档口改成不可压。
 * 变异 M29 咬下面那一行 `{ ...gate, bypassable: false }`。
 */
export function decideHooksModify(input: {
  mode: PermissionMode;
  rules?: ReadonlyArray<PermissionRule>;
  alwaysAsk?: ReadonlyArray<string>;
  /** **规则表这次读不出来**（T74）⇒ 非只读一律硬 ask；不传 = 可信 */
  rulesUntrusted?: boolean;
}): GateDecision {
  const gate = decideGate({
    mode: modeForWrite(input.mode),
    toolName: HOOKS_MODIFY_TOOL,
    kind: 'write',
    // args 里刻意不放 path：配置文件路径由服务层给出，敏感路径判定在这里没有意义
    // （钩子配置**总是**敏感，档口由下面那行硬 ask 保证）
    args: {},
    ...(input.rules ? { rules: input.rules } : {}),
    // T74：规则表读不出来 ⇒ 非只读一律硬 ask（**只传 true** ⇒ 缺省即"可信"）
    ...(input.rulesUntrusted ? { rulesUntrusted: true } : {}),
    ...(input.alwaysAsk ? { alwaysAsk: input.alwaysAsk } : {}),
  });
  if (gate.action === 'ask') return { ...gate, bypassable: false };
  return gate;
}

/**
 * 自证：档口说是硬 ask，结果却"可被压掉"，就是逻辑断了 —— **宁可抛，不要静默放行**。
 * 处理器在弹窗之前调它，所以就算别处改动破坏了上面那条，也不会变成"悄悄不问"。
 */
export function assertHooksHardAskInert(gate: GateDecision): void {
  if (gate.action === 'ask' && gate.bypassable !== false) {
    throw new Error(`[${HOOKS_MODIFY_TOOL}] 应为硬 ask，但拿到了可被「总是允许」压掉的判定 —— 已中止`);
  }
}

/**
 * 弹窗摘要。**必须把要写进去的命令本身带进参数**（与 run_command 同一原则：
 * 审批看不到内容就等于没有审批），所以这里只给一句话定性，完整配置由 args 展开。
 */
export function hooksModifySummary(hookCommands: ReadonlyArray<string>): string {
  const head = '修改钩子配置会以你的宿主环境执行命令';
  if (hookCommands.length === 0) return `${head}（本次提交的配置里没有钩子命令）`;
  const shown = hookCommands.slice(0, 3).join('、');
  const more = hookCommands.length > 3 ? `等 ${String(hookCommands.length)} 条` : '';
  return `${head}：${shown}${more}`;
}

/**
 * 从一份（尚未校验的）配置里尽力取出命令清单，只为弹窗展示服务。
 * 结构不合法时返回空数组 —— 校验与拒绝是 `hooks.save()` 的职责，这里不越权。
 */
export function hookCommandsOf(input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return [];
  const events = (input as { events?: unknown }).events;
  if (typeof events !== 'object' || events === null) return [];
  const out: string[] = [];
  for (const groups of Object.values(events as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const hooks = (group as { hooks?: unknown })?.hooks;
      if (!Array.isArray(hooks)) continue;
      for (const hook of hooks) {
        const cmd = (hook as { command?: unknown })?.command;
        const args = (hook as { args?: unknown })?.args;
        if (typeof cmd === 'string') {
          out.push([cmd, ...(Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : [])].join(' '));
        }
      }
    }
  }
  return out;
}
