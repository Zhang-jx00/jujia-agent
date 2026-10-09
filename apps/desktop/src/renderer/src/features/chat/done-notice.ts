/**
 * 一轮结束时该说的那句话（外部审查 T26 的界面侧）。
 *
 * 为什么单独一个纯函数：判"截断"的依据在 provider 与循环里，而**怎么说**是界面的事；
 * 混在 ChatPanel 的事件回调里就没法单测，也就没法被变异盯住 ——
 * 而这句话正是"用户会不会把半截答案当成完整答案"的分界。
 */

/** 被上游掐断时的说明；没掐断返回 null（不打扰） */
export function truncationNotice(reason: string): string | null {
  if (reason === 'length') {
    return '回答达到长度上限被截断了：这一段是不完整的。可说"继续"接着写，或在设置里调大 max_tokens。';
  }
  if (reason === 'content_filter') {
    return '回答被上游的内容过滤拦下一部分：这一段是不完整的，不是模型写完了。';
  }
  return null;
}
