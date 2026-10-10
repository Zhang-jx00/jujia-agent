import type { ArgSummary } from './redact';

/**
 * 审计记录（M4 收尾 · 其二）。
 *
 * 这一层是**纯的**：不碰磁盘、不取时钟、不读环境变量。
 * 为什么把"一行长什么样"收在一处：写入方与读出方必须认同一个形状，
 * 两边各拼一遍 JSON，早晚会漂成"写得进去、读不出来"的账 —— 而账坏了最坏的结果是没人信它。
 */

export type AuditOutcome = 'allow' | 'ask' | 'deny';
export type AuditAnswer = 'allow_once' | 'allow_always' | 'deny' | 'timeout' | 'expired' | 'edit';

/**
 * 执行器（`runTool`）交出来的**判定事实**。
 *
 * 为什么由 agent-core 给、而不是让调用方自己再去问一遍策略层：判定只在 `decideGate` 发生过一次，
 * 第二次推导就是"两处各说各话"的老病。这里把那一次的结论原样递出来，主进程只负责**抄进账本**
 * （顺带做剔密摘要 —— 摘要动作放在落盘之前，见 `redact.ts`）。
 */
export interface GateAuditInfo {
  toolName: string;
  kind: 'read' | 'write' | 'exec';
  /** 策略判定：allow / ask / deny */
  outcome: AuditOutcome;
  /** 是否真的经过人的手（"要问但被『总是允许』压掉"是 asked=false） */
  asked: boolean;
  /** 问过之后人的答复；没问过就没有这一格 */
  answer?: AuditAnswer | undefined;
  /** 判定理由原文（含命中的规则与命令前缀） */
  reason: string;
  /** 软 ask / 硬 ask（只有 ask 有意义） */
  bypassable?: boolean | undefined;
  durationMs: number;
  /** 本次调用的入参（**原样**，由接收方在落盘前做剔密摘要） */
  args: unknown;
  sessionId: string;
  /** 工具是否真的执行了（deny 一定没执行；这一格让"没做"与"做了但失败"分得开） */
  executed: boolean;
  /**
   * 工具自己声明的命令行参数名（`ToolDefinition.commandArg`）。
   * 审计要留下命令的可读形态，但**只认这条声明** —— 没声明就去猜 `args.command`，
   * 等于在记账这一层重新犯"策略层替工具编参数语义"的错。
   */
  commandArg?: string | undefined;
}
export type AuditKind = 'read' | 'write' | 'exec' | 'gate';

export interface AuditRulesHealth {
  /** 规则文件这次是从哪一档读出来的 */
  source: 'primary' | 'backup' | 'default';
  /** 当前生效的启用规则数 */
  count: number;
  /** 是否走了回退档（主文件损坏 / 读不出来） */
  recovered: boolean;
}

/** 落盘后的健康度形状（`recovered` 在账上写成更直白的 `degraded`） */
export interface AuditRecordRules {
  source: 'primary' | 'backup' | 'default';
  count: number;
  degraded: boolean;
}

export interface AuditRecord {
  ts: string;
  sessionId: string;
  /** 被判定的对象：工具名，或非工具门的虚拟名（`git_commit` / `hooks_modify` / `open_with_*`） */
  subject: string;
  kind: AuditKind;
  outcome: AuditOutcome;
  /** 这次有没有真的经过人的手 */
  asked: boolean;
  /** 判定理由原文（含命中的规则与前缀） */
  reason: string;
  /**
   * 这件事**是否真的做了**（deny / 拒绝 / 超时 = false）。
   * 少了这一格，"没做"与"做了但失败"在账上长得一样 —— 而审计存在的意义正是把两者分开。
   */
  executed: boolean;
  /** 剔密后的参数摘要（见 `redact.ts`） */
  args: ArgSummary;
  /** 用户的答复；只有真问过才有 */
  answer?: AuditAnswer | undefined;
  /** 硬 ask 与否（只有 ask 才有意义：可被"总是允许"压掉 / 压不掉） */
  bypassable?: boolean | undefined;
  durationMs?: number | undefined;
  /** 规则表健康度（T37：读坏了要在账上看得见；调用方没给就不写这一格） */
  rules?: AuditRecordRules | undefined;
}

export interface MakeRecordInput {
  /**
   * 时间由调用方给：纯函数不读时钟，否则测试钉不住、日志里还会冒出"未来的记录"。
   * 类型上写成可选，是因为**缺时间正是要测的那条**（见下面的抛错）；缺了不会被静默补成现在。
   */
  clock?: string | undefined;
  sessionId: string;
  subject: string;
  kind: AuditKind;
  outcome: AuditOutcome;
  /**
   * 见 `AuditRecord.executed`。类型上容许 `undefined` 只为让"整份记录被部分覆盖"的测试夹具能过
   * `exactOptionalPropertyTypes`；**缺了会抛错**，不会被悄悄当成"没做"。
   */
  executed?: boolean | undefined;
  reason: string;
  asked?: boolean;
  answer?: AuditAnswer;
  bypassable?: boolean | undefined;
  durationMs?: number | undefined;
  args?: ArgSummary;
  rules?: AuditRulesHealth | undefined;
}

const EMPTY_ARGS: ArgSummary = { keys: [], lengths: {}, digests: {}, paths: [], redacted: [] };

function clean(text: string): string {
  // 一条记录 = 一行。换行直接**去掉**而不是转义：转义后仍然是一行，但读取器一旦
  // 用"按行切"的简化写法就会把内容里的换行当成边界（与 jsonl 的"末行允许残缺"同族坑）。
  return text.replace(/[\r\n]+/g, '');
}

/** 组装一条记录；非法组合当场抛错（宁可写不进去，也不要写进一条会误导人的账） */
export function makeRecord(input: MakeRecordInput): AuditRecord {
  const clock = input.clock;
  if (typeof clock !== 'string' || clock === '') {
    throw new Error('审计记录必须带时间（由调用方给，纯函数不取时钟）');
  }
  if (input.subject.trim() === '') throw new Error('审计记录必须写明被判定的对象');
  if (input.executed === undefined) {
    throw new Error('审计记录必须写明这件事做没做成（executed）—— "没做"与"做了但失败"在账上不能长一样');
  }
  if (input.sessionId.trim() === '') throw new Error('审计记录必须写明会话（没有会话就写 manual）');
  // "拒了却记成问过了"是最坏的一种记法：它把没做的事记成有人做过决定
  if (input.asked === true && input.outcome !== 'ask') {
    throw new Error(`判定是 ${input.outcome}，不该记成"经过人的手"（asked=true 只允许配 outcome=ask）`);
  }
  if (input.asked === true && input.answer === undefined) {
    throw new Error('记了"问过"就必须记答复（allow / deny / timeout / expired）');
  }

  const record: AuditRecord = {
    ts: clean(clock),
    sessionId: clean(input.sessionId),
    subject: clean(input.subject),
    kind: input.kind,
    outcome: input.outcome,
    asked: input.asked === true,
    executed: input.executed === true,
    reason: clean(input.reason),
    args: input.args ?? EMPTY_ARGS,
    ...(input.answer !== undefined ? { answer: input.answer } : {}),
    ...(input.bypassable !== undefined ? { bypassable: input.bypassable } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.rules !== undefined
      ? {
          rules: {
            source: input.rules.source,
            count: input.rules.count,
            degraded: input.rules.recovered,
          },
        }
      : {}),
  };
  return record;
}

/** 序列化成 JSONL 的一行（不含换行；换行由写入方加） */
export function formatAuditLine(record: AuditRecord): string {
  return JSON.stringify(record);
}

/**
 * 读回一行。返回 null 表示"这行不能算记录"（空行或残缺的末行）——
 * 由调用方决定怎么说"有几条没读出来"，这里不静默也不抛错。
 */
export function parseAuditLine(line: string): AuditRecord | null {
  const text = line.trim();
  if (text === '') return null;
  try {
    const raw = JSON.parse(text) as Partial<AuditRecord>;
    if (
      typeof raw['ts'] !== 'string' ||
      typeof raw['subject'] !== 'string' ||
      typeof raw['sessionId'] !== 'string' ||
      (raw['outcome'] !== 'allow' && raw['outcome'] !== 'ask' && raw['outcome'] !== 'deny')
    ) {
      return null;
    }
    return {
      ts: raw['ts'],
      sessionId: raw['sessionId'],
      subject: raw['subject'],
      kind: (raw['kind'] as AuditKind | undefined) ?? 'gate',
      outcome: raw['outcome'],
      asked: raw['asked'] === true,
      executed: raw['executed'] === true,
      reason: typeof raw['reason'] === 'string' ? raw['reason'] : '',
      args: (raw['args'] as ArgSummary | undefined) ?? EMPTY_ARGS,
      ...(typeof raw['answer'] === 'string' ? { answer: raw['answer'] as AuditAnswer } : {}),
      ...(typeof raw['bypassable'] === 'boolean' ? { bypassable: raw['bypassable'] } : {}),
      ...(typeof raw['durationMs'] === 'number' ? { durationMs: raw['durationMs'] } : {}),
      ...(raw['rules'] !== undefined ? { rules: raw['rules'] as AuditRecordRules } : {}),
    };
  } catch {
    return null;
  }
}
