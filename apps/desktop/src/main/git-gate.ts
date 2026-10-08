import { decideGate, type GateDecision, type PermissionMode, type PermissionRule } from '@jujia/agent-core';

/**
 * git 动作的权限档（M8 接线的**唯一**判档处）。
 *
 * 为什么单独抽成一个纯函数文件（与 `config-write.ts` 同一个理由）：
 * 接线之后"要不要问人"这件事如果散在 IPC handler 里，就**既测不动、变异也咬不到** ——
 * 变异测试要求锚点落在一行真实的代码上，而不是落在一串胶水中间。
 *
 * 三档的口径来自所有者（见 `docs/WORK-PROTOCOL.md` 速查表与 `docs/HANDOVER.md` §3.2）：
 *
 * | 动作 | 性质 | 档位 |
 * |------|------|------|
 * | `status` / `diff` / `log` | 只读，不改任何东西 | **不问**（只读不打扰） |
 * | `stage` / `unstage` | 改暂存区，**可逆**（再 unstage 就回来了） | **软 ask**（可以「本次会话总是允许」） |
 * | `commit` | **写仓库历史**，事后只能靠 revert 补救 | **硬 ask**（任何"总是允许"都压不掉） |
 * | `push` | **外发远端**，别人看得见，撤回需要远端配合 | **硬 ask，且永远不可被「总是允许」压掉**（M8 收口） |
 */

export const GIT_ACTIONS = ['status', 'diff', 'log', 'stage', 'unstage', 'commit', 'push'] as const;
export type GitAction = (typeof GIT_ACTIONS)[number];

const READ_ACTIONS: ReadonlyArray<GitAction> = ['status', 'diff', 'log'];
const SOFT_ACTIONS: ReadonlyArray<GitAction> = ['stage', 'unstage'];
/**
 * 硬 ask 的两个动作**理由不同**，所以文案分开写（见 `gitRequestSummary`）：
 * `commit` 改的是本地历史，`push` 是把它交到别人手里。两件事都不能被"总是允许"糊过去。
 */
const HARD_ACTIONS: ReadonlyArray<GitAction> = ['commit', 'push'];

export type GitAskClass = 'none' | 'soft' | 'hard';

/** 该动作属于哪一档。不在清单里的动作**直接抛**，不"默认不问"。 */
export function gitAskClass(action: GitAction): GitAskClass {
  if (READ_ACTIONS.includes(action)) return 'none';
  if (SOFT_ACTIONS.includes(action)) return 'soft';
  if (HARD_ACTIONS.includes(action)) return 'hard';
  throw new Error(`[git] 未知动作，按最严格处理：${String(action)}`);
}

/** 权限规则表里用的工具名（用户可以对自己的 git 动作写 allow / deny / ask 规则）。 */
export function gitToolName(action: GitAction): string {
  return `git_${action}`;
}

/**
 * `acceptEdits` 的字面意思是"工作区内的**文件编辑**自动放行"，**不包括写仓库历史**：
 * 一次 commit 会把当前暂存的内容永久记进历史，那不是"编辑一下"能覆盖的授权范围。
 * 所以硬 ask 动作在这个模式下降回 `default`（照样要问）。
 *
 * 刻意**不降**两类"看得见、写下来"的决定：用户自己写的 allow 规则、以及 `bypassPermissions` 模式 ——
 * 那两条是引擎里既有的显式让路口径（见 `policy.ts` 的决策顺序），在这里偷偷改掉反而不一致。
 */
function modeForAction(action: GitAction, mode: PermissionMode): PermissionMode {
  if (gitAskClass(action) === 'hard' && mode === 'acceptEdits') return 'default';
  return mode;
}

/**
 * 判档：把动作翻译成引擎的 `GateDecision`。
 *
 * 走的是与工具执行**同一个** `decideGate`，所以用户写的 `git_*` 规则、
 * plan / dontAsk 只读模式、bypassPermissions 全部照常生效 ——
 * 不搞第二套权限语义，那正是"看起来有防护"的典型形状。
 */
export function decideGitAction(input: {
  action: GitAction;
  mode: PermissionMode;
  rules?: ReadonlyArray<PermissionRule>;
  alwaysAsk?: ReadonlyArray<string>;
}): GateDecision {
  const gate = decideGate({
    mode: modeForAction(input.action, input.mode),
    toolName: gitToolName(input.action),
    // 只读动作给 'read'（引擎第 1 条直接放行）；写动作给 'write'。
    // 刻意不给 'exec'：git 动作不是"执行任意命令"，档位由下面这张清单说了算。
    kind: gitAskClass(input.action) === 'none' ? 'read' : 'write',
    // args 里**不放** path：敏感路径判定针对的是"往哪个文件写"，
    // 而 git 的目标就是仓库本身（含 .git），放上去会让每次提交都被判成敏感路径。
    args: {},
    // 项目开了 exactOptionalPropertyTypes：没传就别把 undefined 塞进可选属性
    ...(input.rules ? { rules: input.rules } : {}),
    ...(input.alwaysAsk ? { alwaysAsk: input.alwaysAsk } : {}),
  });
  // **硬 ask 的落地点**：引擎对 'write' 给的是软 ask（可被"总是允许"压掉），
  // 而 commit 必须每次过人手 —— 在这里改成不可压。变异测试 M10 咬的就是这一行。
  if (gitAskClass(input.action) === 'hard' && gate.action === 'ask') {
    return { ...gate, bypassable: false };
  }
  return gate;
}

/**
 * 自证：档位说是硬 ask，结果却"可被压掉"，就是逻辑断了 —— **宁可抛，不要静默放行**。
 * 服务层在弹窗之前调它，所以就算别处改动破坏了上面那条，也不会变成"悄悄不问"。
 */
export function assertHardAskInert(action: GitAction, gate: GateDecision): void {
  if (gitAskClass(action) === 'hard' && gate.action === 'ask' && gate.bypassable !== false) {
    throw new Error(`[git] ${gitToolName(action)} 应为硬 ask，但拿到了可被「总是允许」压掉的判定 —— 已中止`);
  }
}

/** 用户点「本次会话总是允许」时，这条决定是否该被记住（只有软 ask 才配）。 */
export function shouldRememberAlwaysAllow(
  action: GitAction,
  gate: GateDecision,
  decision: string,
): boolean {
  if (decision !== 'allow_always') return false;
  if (gate.action !== 'ask') return false;
  return gitAskClass(action) === 'soft' && gate.bypassable === true;
}

/**
 * 弹窗要展示的摘要。**两条硬 ask 各自写清自己的后果**（所有者的原话要求：
 * 只说"确认执行 git commit 吗"等于没提示 —— 用户分不清"暂存"和"改历史"，更分不清"改历史"和"交给别人"）：
 * - `commit` → 会写入仓库历史（可 revert 补救，但不会自动撤销）
 * - `push` → 发到远端、别人看得见（撤回要远端配合，我们不做强推）
 */
export function gitRequestSummary(
  action: GitAction,
  detail: { paths?: ReadonlyArray<string>; message?: string; remote?: string; branch?: string | null },
): string {
  const head = gitAskClass(action) === 'hard' ? `会写入仓库历史（可用 revert 补救，但不会自动撤销）：` : '';
  switch (action) {
    case 'stage':
      return `暂存 ${String(detail.paths?.length ?? 0)} 个文件：${(detail.paths ?? []).slice(0, 5).join('、')}`;
    case 'unstage':
      return `取消暂存 ${String(detail.paths?.length ?? 0)} 个文件：${(detail.paths ?? []).slice(0, 5).join('、')}`;
    case 'commit':
      return `${head}提交信息「${(detail.message ?? '').slice(0, 80)}」`;
    case 'push': {
      const where = detail.remote ?? '远端';
      const what = detail.branch === null || detail.branch === undefined || detail.branch === ''
        ? '当前分支（HEAD）'
        : `分支「${detail.branch}」`;
      return `发到远端「${where}」的${what} —— 别人看得见，撤回需要远端配合；本应用不做强推（--force）`;
    }
    default:
      return `${gitToolName(action)}（只读，不需要确认）`;
  }
}
