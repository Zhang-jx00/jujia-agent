/**
 * 会话淘汰策略（轨道回归计划 1 · M1）。
 *
 * 为什么单独成文件：这段逻辑要能**单测**，而 `chat-service.ts` 会拉起
 * `connections-store`（间接依赖 electron），测试环境里不好加载。
 * 把"挑谁淘汰"抽成纯函数，逻辑就有真实测试，而不是靠源码文本断言糊过去。
 */

export interface EvictableSession {
  id: string;
  /** 最近一次使用时间（毫秒时间戳） */
  lastUsedAt: number;
  /** 正在生成中：**不淘汰**（否则会把用户正在等的对话删掉） */
  running: boolean;
}

/**
 * 选出应当淘汰的会话 id；没有可淘汰对象时返回 `null`。
 *
 * @param items 当前驻留的会话
 * @param max 会话数上限
 * @returns 需要淘汰的 id（最久未使用者），或 null
 */
export function pickEvictionCandidate(
  items: ReadonlyArray<EvictableSession>,
  max: number,
): string | null {
  if (max <= 0) return null;
  if (items.length < max) return null;
  // 正在运行的一律不动 —— 宁可暂时超出上限，也不打断用户手上的对话
  const candidates = items.filter((s) => !s.running);
  if (candidates.length === 0) return null;
  let oldest = candidates[0];
  if (oldest === undefined) return null;
  for (const s of candidates) {
    if (s.lastUsedAt < oldest.lastUsedAt) oldest = s;
  }
  return oldest.id;
}

/**
 * 淘汰后的会话数上限判断：**是否需要继续淘汰**。
 * 为避免"一次淘汰一个"与"上限差 1"的边界写错，这里把判断也收成一处。
 */
export function needsEviction(count: number, max: number): boolean {
  return count >= max;
}
