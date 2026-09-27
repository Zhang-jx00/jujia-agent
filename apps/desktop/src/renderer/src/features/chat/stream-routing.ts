/**
 * 流事件的分发判据（外部审查 T5）。
 *
 * 为什么需要：`CHAT_STREAM` 是**全局广播**，而对话面板只该画"自己这个会话"的那一份。
 * 修之前这里没筛，于是形状是：会话 A 还在流式输出，用户切到 B（或新建会话），
 * A 的 `done` / `error` / `usage` / `tool_*` 照样落到 B 的状态上 ——
 * 增量本身因为 `messageId` 对不上而看起来"没事"，但那四支不需要 messageId，**直接就改得见面错**。
 *
 * 为什么单独一个文件、只有这一个函数：这是"事件到视图"的唯一闸口，
 * 放在面板里就混在几十行 setState 中间，变异测试咬不到、接线锁也钉不住。
 */
export interface SessionScoped {
  /** 六类流事件（text_delta / tool_start / tool_end / usage / error / done）都带这个字段 */
  sessionId: string;
}

/**
 * 这条事件是否属于当前正在看的会话。
 *
 * `currentSessionId === undefined`（还没发过问、也没续上任何会话）时**一律丢弃** ——
 * 那一刻界面是空的，任何事件进来都只会被当成"上一个会话的遗言"画在新窗口上。
 */
export function belongsToSession(
  event: SessionScoped,
  currentSessionId: string | undefined,
): boolean {
  return currentSessionId !== undefined && event.sessionId === currentSessionId;
}
