import type { DoneEndReason } from '@jujia/shared-ipc';

/**
 * 一轮结束时该说的那句话（外部审查 T26 的界面侧）。
 *
 * 为什么单独一个纯函数：判"截断"的依据在 provider 与循环里，而**怎么说**是界面的事；
 * 混在 ChatPanel 的事件回调里就没法单测，也就没法被变异盯住 ——
 * 而这句话正是"用户会不会把半截答案当成完整答案"的分界。
 *
 * T58（2026-10-15）把它从 `if` 链改成**以契约为键的穷举表**：
 * 旧写法是 `reason: string` + 两条 if，于是契约里躺着一个主进程永不发送的 `tool_calls`，
 * 而 ChatPanel 有一条活分支读它 —— 没人会发现那条路径不存在。
 * 现在契约新增一个成员而这张表没补，**编译直接不过**（缺键的 `Record` 是类型错误）。
 * 表导出（`DONE_REASON_NOTICE`）而不是藏在函数里：一致性测试要拿它的键集合与契约对账。
 */

/** 契约里的每一个结束原因，界面都要有自己的说法（null = 这一格不该我说话） */
export const DONE_REASON_NOTICE: Record<DoneEndReason, string | null> = {
  // 正常写完：没什么要补的
  stop: null,
  length: '回答达到长度上限被截断了：这一段是不完整的。可说"继续"接着写，或在设置里调大 max_tokens。',
  content_filter: '回答被上游的内容过滤拦下一部分：这一段是不完整的，不是模型写完了。',
  // 用户按停止 / 出错：各有各的格子（气泡上的"已停止"与错误行），在这里重复说会互相盖
  aborted: null,
  error: null,
};

/** 被上游掐断时的说明；没掐断返回 null（不打扰） */
export function truncationNotice(reason: DoneEndReason): string | null {
  // `?? null` 兜的是**运行期**：契约之外的值（旧主进程、手工构造的事件）不该让界面崩，
  // 说不出话就是 null —— 但编译期已经先拦住"新增成员没补表"这一种，那才是本条要治的。
  return DONE_REASON_NOTICE[reason] ?? null;
}
