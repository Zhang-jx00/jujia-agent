/**
 * 上下文压缩的**纯决策层**（铺设计划 6b · 报备 `docs/DESIGN-COMPACT.md` 已批）。
 *
 * 这里只做判断，不做 IO、不碰 electron、不调模型 —— 因为 `chat-service` 在 vitest 里根本加载不了
 * （6a 抽出 `session-journal.ts` 就是同一个理由）。"决定模型看到什么"的逻辑必须能被单测与变异钉死。
 *
 * **坐标系**（批复②）：`compactedThrough` 是**落盘序列的行号**，不是内存数组下标。
 * 内存里的第 0 条是 system 提示，它不落盘、每轮重新装配；中途还可能再插入 system 说明
 * （没选工作区那条）。所以先把 system 剔掉、再按剩下的序列数行号 —— 这样重启前后是同一个坐标。
 *
 * 两个不变量（都是本轮批复点名的）：
 * - **阈值只看水印之后的未压缩部分**：否则一个长会话压过一次之后会被永远追问；
 * - **压缩只是"提示"**：本模块绝不落盘、绝不改消息，动手必须由人来点。
 */

export type Turn = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };

/** 双阈值（DESIGN-SESSIONS §四 已批的数字）：轮数 **或** 未压缩字节，命中即提示 */
export const COMPACT_MIN_ROUNDS = 24;
export const COMPACT_MIN_BYTES = 64 * 1024;
/** 发给模型的"最近原文"条数上限（与给人看的分页窗口 120 条无关） */
export const RECENT_TAIL_K = 12;
/** 摘要段上限：按**码位**算，不是 UTF-16 长度 —— 中文与 emoji 不该被当成一字符一节 */
export const SUMMARY_MAX_CHARS = 1200;

export interface ContextShape {
  /** 未压缩部分里的用户消息条数 */
  rounds: number;
  /** 未压缩部分的消息条数（不含 system） */
  uncompressedMessages: number;
  /** 未压缩部分的 UTF-8 字节数 */
  uncompressedBytes: number;
}

/** 落盘坐标下的序列：剔掉所有 system（它们不落盘、每轮重装配） */
const persisted = <T extends Turn>(messages: T[]): T[] => messages.filter((m) => m.role !== 'system');

export function measureContext<T extends Turn>(messages: T[], compactedThrough: number): ContextShape {
  const seq = persisted(messages);
  const from = Math.min(Math.max(compactedThrough, 0), seq.length);
  const tail = seq.slice(from);
  return {
    rounds: tail.filter((m) => m.role === 'user').length,
    uncompressedMessages: tail.length,
    uncompressedBytes: tail.reduce((acc, m) => acc + Buffer.byteLength(m.content, 'utf8'), 0),
  };
}

export function decideCompactPrompt(shape: ContextShape): { shouldPrompt: boolean; reason: string } {
  // 只有一处提问的口吻：界面在这句话后面直接跟「压缩此会话」按钮，末尾再问一次就成了两个人在问
  const ask =
    '要不要把早先的内容压成要点摘要？原始记录不会删除，只影响接下来发给模型的上下文。';
  const kb = Math.round(shape.uncompressedBytes / 1024);
  if (shape.rounds >= COMPACT_MIN_ROUNDS) {
    return {
      shouldPrompt: true,
      reason: `这个会话已经长了（压缩之后又攒了 ${String(shape.rounds)} 轮 / 约 ${String(kb)} KB）。${ask}`,
    };
  }
  if (shape.uncompressedBytes >= COMPACT_MIN_BYTES) {
    return {
      shouldPrompt: true,
      reason: `这个会话已经长了（压缩之后又有 ${String(kb)} KB 未压缩内容 / ${String(shape.rounds)} 轮）。${ask}`,
    };
  }
  return { shouldPrompt: false, reason: '' };
}

/**
 * 重建"发给模型的历史"：system 全留 + 水印之后的最近 K 条。
 *
 * K 是**上限**而不是目标：调用方给一个巨大的 K 也不能把整个历史灌回去 ——
 * 这一层存在的意义就是让上下文有上界。
 */
export function selectHistoryForModel<T extends Turn>(
  messages: T[],
  compactedThrough: number,
  k: number = RECENT_TAIL_K,
): T[] {
  const limit = Math.min(Math.max(k, 1), RECENT_TAIL_K);
  const seq = persisted(messages);
  const tail = seq.slice(Math.min(Math.max(compactedThrough, 0), seq.length));
  const keep = new Set(tail.slice(-limit));
  // 按原始位置留下来：system 在哪一轮注入的就还在哪，别把上下文顺序打乱
  return messages.filter((m) => keep.has(m) || m.role === 'system');
}

/** 按码位截断，绝不切出半个代理对 */
export function capSummary(summary: string): { text: string; truncated: boolean } {
  const chars = [...summary];
  if (chars.length <= SUMMARY_MAX_CHARS) return { text: summary, truncated: false };
  return { text: chars.slice(0, SUMMARY_MAX_CHARS).join(''), truncated: true };
}

/**
 * 会话摘要注入段 —— 文本必须与报备 §三 一致（漂移就是语义漂移，所以有单测逐句钉着）。
 * 摘要为空时**返回空串**：空摘要进上下文等于告诉模型"早先什么都没发生"。
 */
export function buildSummarySection(input: { summary: string; through: number; sessionId: string }): string {
  const body = input.summary.trim();
  if (body === '') return '';
  const capped = capSummary(body);
  const note = capped.truncated ? '\n\n（摘要过长，已截断）' : '';
  return (
    `## 会话早先内容的要点摘要（由模型生成，非用户亲述）\n` +
    `如与"摘要之后的原始对话"冲突，一律以原始对话为准。\n` +
    `来源：sessions/${input.sessionId}/summary.md ｜ 覆盖到第 ${String(input.through)} 条为止\n` +
    `${capped.text}${note}\n\n` +
    `## 摘要之后的原始对话`
  );
}

/** 单条消息进 prompt 前的截断长度：工具输出可能几千字，全塞进去等于用一次调用赌预算 */
const PROMPT_PER_MESSAGE_MAX_CHARS = 2_000;

function clipForPrompt(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= PROMPT_PER_MESSAGE_MAX_CHARS) return oneLine;
  return `${oneLine.slice(0, PROMPT_PER_MESSAGE_MAX_CHARS)}…（已截断，原 ${String(oneLine.length)} 字）`;
}

/** 落盘坐标下的编号：水印之后第一条是第 `through+1` 条 —— 摘要里的行号必须能回到原始 jsonl */
function numberedTail<T extends Turn>(messages: T[], compactedThrough: number): string {
  const seq = persisted(messages);
  const from = Math.min(Math.max(compactedThrough, 0), seq.length);
  return seq
    .slice(from)
    .map((m, i) => `[${String(from + i + 1)}] ${m.role}: ${clipForPrompt(m.content)}`)
    .join('\n');
}

const COMMON_RULES =
  '只保留后续工作真正需要的信息，不要叙事、不要寒暄；原文里没有的不要编，拿不准就写"未确认"。';

/**
 * A（compact）的摘要 prompt。四类必保事实与 §七 的"关键事实对照清单"验收**是同一套四类** ——
 * 在这里由代码产出、被单测逐条钉住，就不会出现"prompt 说要保留人名、测试却只查路径"这种两头漂移。
 */
export function buildCompactPrompt<T extends Turn>(messages: T[], compactedThrough: number): string {
  const body = numberedTail(messages, compactedThrough);
  if (body === '') return '';
  return (
    '你在为一个桌面 Agent 的长会话做上下文压缩。把下面的对话压成要点清单，供之后的同一会话参考。\n' +
    '要求：\n' +
    `1. ${COMMON_RULES}\n` +
    '2. 下面四类事实**一条都不能丢**，各自单列小节：人名与称呼 / 文件与目录路径 / 数字与阈值 / ' +
    '已做出的决定与被否决的方案；\n' +
    '3. 未做完的事项与未决问题单独列出，标明卡在哪一步；\n' +
    `4. 每条要点前标出它来自第几条消息（下面每行开头的方括号就是原始行号），便于回溯；\n` +
    `5. 总长不超过 ${String(SUMMARY_MAX_CHARS)} 字符。\n` +
    '输出就是要点清单本身，不要额外的开场与结尾。\n\n' +
    '对话原文：\n' +
    `${body}`
  );
}

/**
 * B（会话结束写长期记忆）的 prompt：压成**一条**可被日后读懂的话。
 * 与 A 的区别不是长度，是用途 —— 这条会跨会话注入，所以必须"下次一看就知道当时卡在哪"，
 * 而不是"本次任务顺利完成"这种没有信息量的成功陈述。
 */
export function buildNotePrompt<T extends Turn>(messages: T[]): string {
  const body = numberedTail(messages, 0);
  if (body === '') return '';
  return (
    '把下面这段会话压成**一条**记忆，供以后的新会话参考。格式要求：\n' +
    `1. ${COMMON_RULES}\n` +
    '2. 只写一条，80 字以内，一行写完，不要分点、不要标题；\n' +
    '3. 必须交代：这次做成的是什么，以及**未决事项或踩到的坑**（如果全部做完了就写"无未决"）；\n' +
    '4. 不要写成功陈述与情绪评价，只写下次用得上的事实（含路径、名字、数字）。\n' +
    '输出就是那一条本身，不要任何前后缀。\n\n' +
    '对话原文：\n' +
    `${body}`
  );
}
