/**
 * 钩子诊断**怎么念出口**（T51 · 2026-10-15）。
 *
 * 为什么单独成模块：`runner.ts` 认真产了三种诊断（超时未生效 / 启动失败 / matcher 非法），
 * 而消费侧三处（工具结果、回合结果、会话启动）各有各的"说法"。格式化写三份，
 * 早晚变成"同一个钩子在三处三种说法"—— 那正是本模块存在的理由（与 `points.ts` 同一条纪律）。
 *
 * 为什么必须有出口：钩子契约是 **fail-open**（钩子坏了不阻断，见 `hooks/types.ts` 要点 5），
 * 代价就是"钩子没跑成"这件事必须可见。一条拒收危险操作的 PreToolUse 钩子的二进制被卸载
 * ⇒ `blocked:false` ⇒ 工具照常执行，而没有任何地方说过"那道关今天没上班"。
 *
 * 两条出口分别对应两类观众，但**措辞只在这一处定义**：
 * - `appendHookDiagnostics`：接进**工具结果**（模型与工具卡读同一份话，不新开一条消息）；
 * - `hookDiagnosticsNotice`：给**回合级**那一格（与"这一轮没写进磁盘"共用 `done.notice`）。
 */

/** 统一标记：界面、模型、日志里都靠它认出"这是钩子的病症，不是工具的答复" */
export const HOOK_DIAGNOSTIC_MARKER = '[钩子诊断]';

/**
 * 一次最多念出来几条。
 * 上界的理由与工具输出同一套：诊断可能来自多个钩子多个组，全铺会把一格的提示撑成一面墙，
 * 而墙的后果是整条被折叠掉——**看不见等于没发生**，所以宁可说"还有几条"。
 */
export const HOOK_DIAGNOSTIC_MAX_LINES = 5;

function withCap(diagnostics: readonly string[]): string[] {
  if (diagnostics.length <= HOOK_DIAGNOSTIC_MAX_LINES) return [...diagnostics];
  return [
    ...diagnostics.slice(0, HOOK_DIAGNOSTIC_MAX_LINES),
    `还有 ${String(diagnostics.length - HOOK_DIAGNOSTIC_MAX_LINES)} 条没念出来`,
  ];
}

/** 接进工具结果：没有诊断时**原样返回**（不许留空标记，见测试里的反向对照） */
export function appendHookDiagnostics(content: string, diagnostics: readonly string[]): string {
  if (diagnostics.length === 0) return content;
  const body = withCap(diagnostics)
    .map((line) => `- ${line}`)
    .join('\n');
  return `${content}\n\n${HOOK_DIAGNOSTIC_MARKER}\n${body}`;
}

/** 回合级那句：单行、分号连；没有诊断时返回空串（调用方按空串决定是否占格） */
export function hookDiagnosticsNotice(diagnostics: readonly string[]): string {
  if (diagnostics.length === 0) return '';
  const capped = withCap(diagnostics);
  return `${HOOK_DIAGNOSTIC_MARKER} ${capped.join('；')}`;
}
