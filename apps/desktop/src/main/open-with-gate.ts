import { decideGate, type GateDecision, type PermissionMode, type PermissionRule } from '@jujia/agent-core';

/**
 * 「打开方式」三档的权限档（M10 收尾 · **唯一**判档处）。
 *
 * 同样是抽成纯函数，理由与 `git-gate.ts` 一致：判档散在 IPC handler 里就**既测不动、变异也咬不到**。
 *
 * 口径来自所有者（2026-09-26 批复，见 `docs/WORK-PROTOCOL.md` 速查表）：
 *
 * | 目标 | 性质 | 档位 |
 * |------|------|------|
 * | `internal` | 交给内置视图，安全钩子全开（协议白名单 / 不得跨站 / 无 preload） | **不问** —— 地址是用户自己输的，那次输入就是授权（G-6 口径） |
 * | `system` | 交给**系统默认浏览器** | **硬 ask** |
 * | `custom` | 交给**用户自选的本机程序** | **硬 ask** |
 *
 * 为什么后两档必须问、而且必须"每次"问：地址一旦离开本应用，就脱离了上面那四层防线 ——
 * 外部浏览器不受我们的导航策略约束，自选程序更是"让本机去执行一个进程"。
 * 这属于**本机外发动作**，与 git 的 `push`（外发远端）同一类，所以取同一档。
 *
 * 为什么**没有**"总是允许"这条路：软 ask 的意义是"同类操作很多、每次都问会累"（如暂存文件）。
 * 而"把地址交给外部程序"不是高频重复操作，一次授权也不该外溢到下一个网址 ——
 * 尤其下一个网址可能是别人构造的。设置页能记住的只有**默认预选哪一档**，记不住授权。
 */

export const OPEN_TARGETS = ['internal', 'system', 'custom'] as const;
export type OpenTarget = (typeof OPEN_TARGETS)[number];

export type OpenAskClass = 'none' | 'hard';

/** 该目标属于哪一档。不在清单里的**直接抛**，不"默认不问"。 */
export function openAskClass(target: OpenTarget): OpenAskClass {
  if (target === 'internal') return 'none';
  if (target === 'system' || target === 'custom') return 'hard';
  throw new Error(`[open-with] 未知的打开方式，按最严格处理：${String(target)}`);
}

/** 权限规则表里用的名字（用户可以给自己写 `open_with_custom: deny` 这类规则） */
export function openToolName(target: OpenTarget): string {
  return target === 'internal' ? 'open_internal' : `open_with_${target}`;
}

/**
 * 判档：走的是与工具执行、git 动作**同一个** `decideGate`。
 *
 * `kind` 给 `'exec'`：外部程序启动在执行引擎眼里就是"跑一个本机进程"，
 * 于是 `plan` / `dontAsk` 模式、用户规则、`bypassPermissions` 全部按既有语义生效，
 * 不用在这里再造一套。硬 ask 的落地点在下面那行 `bypassable: false`（变异 M17 咬它）。
 */
export function decideOpenTarget(input: {
  target: OpenTarget;
  mode: PermissionMode;
  rules?: ReadonlyArray<PermissionRule>;
  alwaysAsk?: ReadonlyArray<string>;
}): GateDecision {
  const gate = decideGate({
    mode: input.mode,
    toolName: openToolName(input.target),
    kind: openAskClass(input.target) === 'hard' ? 'exec' : 'read',
    // args 里不放 path/url：url 可能很长且不是"往哪写"的判定依据，规则表按工具名匹配
    args: {},
    ...(input.rules ? { rules: input.rules } : {}),
    ...(input.alwaysAsk ? { alwaysAsk: input.alwaysAsk } : {}),
  });
  if (openAskClass(input.target) === 'hard' && gate.action === 'ask') {
    return { ...gate, bypassable: false };
  }
  return gate;
}

/**
 * 自证：说是硬 ask 却拿到"可被压掉"的判定 = 逻辑断了 —— **宁可抛，不静默放行**。
 * 服务层在弹窗之前调它，所以即使别处改松了也不会变成"悄悄不问"。
 */
export function assertOpenHardAskInert(target: OpenTarget, gate: GateDecision): void {
  if (openAskClass(target) === 'hard' && gate.action === 'ask' && gate.bypassable !== false) {
    throw new Error(`[open-with] ${openToolName(target)} 应为硬 ask，但拿到了可被「总是允许」压掉的判定 —— 已中止`);
  }
}

/**
 * 弹窗摘要。**必须让人看见"这一步会把地址交给外部"**：
 * 只写"确认打开吗"等于没提示 —— 用户分不清"在应用里看"和"交给别的程序看"的差别。
 */
export function openRequestSummary(
  target: OpenTarget,
  detail: { url: string; exePath?: string },
): string {
  const url = detail.url.length > 160 ? `${detail.url.slice(0, 160)}…（网址过长已截断）` : detail.url;
  const head = '地址将离开本应用的安全边界（外部程序不受本应用的导航策略约束）：';
  if (target === 'custom') {
    return `${head}用本机程序「${detail.exePath ?? '(未选择)'}」打开 ${url}`;
  }
  return `${head}用系统默认浏览器打开 ${url}`;
}
