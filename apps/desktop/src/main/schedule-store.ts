import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from '@jujia/shared';
import { parseRule } from '@jujia/agent-core';
import {
  MAX_SCHEDULED_TASKS,
  SCHEDULE_JITTER_WINDOW_MS,
  SCHEDULE_NAME_MAX_CHARS,
  SCHEDULE_PROMPT_MAX_CHARS,
  SCHEDULE_RULE_MAX_CHARS,
  type ScheduledTask,
  scheduledTaskSchema,
} from '@jujia/shared-ipc';

/**
 * 定时任务这本账（M7 · R9）。
 *
 * 三条规矩都是从既有模块抄来的，不是新发明：
 * 1. **校验只有一处**（`validateTaskInput`）。内存孪生与文件版共用同一个内核（`createCore`），
 *    照的是 `permission-rules-store.ts` 的做法 —— 否则"文件版多一条规则、内存版没有"
 *    就是又一处「同一件事在两处各说各话」。
 * 2. **读—改—写必须在临界区里**。本模块的每一次写都是这个形状（记账、启停、删除、改规则）。
 *    只串行化写不够 —— 6a 的 T6③ 栽过一次，`pending-notes.ts` 的注释里也写着同一条。
 * 3. **账本上没有"免审批"这一格**：`autoApprove` / `alwaysAllow` 之类**在保存时就拒**，
 *    而不是"存着不用"。定时不等于免审批（这是停牌①的口径：不自行开常驻放行的口子），
 *    而"填了也不生效的开关"比根本没有这个开关更坏。
 */

/** 任务 id 全部来自 `randomUUID()`；白名单按这个形态收紧（守卫放在被守卫的代码里面，不指望调用点记得） */
const TASK_ID = /^[a-z0-9-]{6,64}$/;

/** 这些键一旦出现在载荷里就整条拒收 —— 见文件头第 3 条 */
const FORBIDDEN_KEYS = ['autoApprove', 'alwaysAllow', 'skipPermission', 'bypass', 'approved'];

export interface RunMark {
  at: string;
  skipped: number;
  error?: string;
  sessionId?: string | null;
}

export type UpsertResult = { ok: true; task: ScheduledTask } | { ok: false; error: string };
export type MarkResult = { ok: true; task: ScheduledTask } | { ok: false; error: string };
export type SimpleResult = { ok: boolean; error: string };

export interface ScheduleStore {
  list(): Promise<ScheduledTask[]>;
  get(id: string): Promise<ScheduledTask | null>;
  /** 新增（`id` 为空）或修改（带 `id`）；成功后返回落盘的这一条 */
  upsert(input: unknown): Promise<UpsertResult>;
  remove(id: string): Promise<SimpleResult>;
  setEnabled(id: string, enabled: boolean): Promise<SimpleResult>;
  /** 触发的水位线：只有这里能写 `lastRunAt` / `lastSkipped` / `lastError` */
  markRun(id: string, mark: RunMark): Promise<MarkResult>;
  /** 清单读不出来时的实话（回落备份、版本不认识…）；空串 = 一切正常。界面必须显示得出来 */
  health(): Promise<string>;
}

function tooLong(label: string, value: string, max: number): string | null {
  return value.length > max ? `${label}太长（${String(value.length)} 个字符，上限 ${String(max)}）` : null;
}

function textOf(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** 校验的输入：载荷 + 已有的同 id 任务（改的时候锚点与抖动要继承，不能重算） */
export interface ValidateContext {
  existing?: ScheduledTask | null;
  now?: Date;
}

/**
 * 一份载荷能不能成为一条任务。**判据的唯一出处**，返回规整好的任务或一句人话。
 *
 * 刻意不直接抛 zod 的原文：它给的是英文 `Unrecognized key(s)…`，
 * 而这里必须**点名**被拒的是哪个键（界面要照着这句话解释"为什么填了没生效"）。
 * 形状与上限仍由 `scheduledTaskSchema` 兜底（就在最后一步）。
 */
export function validateTaskInput(
  input: unknown,
  ctx: ValidateContext = {},
): { ok: true; task: ScheduledTask } | { ok: false; error: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '任务应当是一个对象' };
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      return {
        ok: false,
        error: `定时任务不支持「${key}」这一格：到点触发照走同一扇权限门（定时不等于免审批）`,
      };
    }
  }

  const name = textOf(raw, 'name');
  if (name === '') return { ok: false, error: '名字不能是空的（清单里要认得出这是哪一条）' };
  const nameTooLong = tooLong('名字', name, SCHEDULE_NAME_MAX_CHARS);
  if (nameTooLong !== null) return { ok: false, error: nameTooLong };

  const rule = textOf(raw, 'rule').toUpperCase();
  if (rule === '') return { ok: false, error: '规则不能是空的（例如 FREQ=DAILY;BYHOUR=9）' };
  const ruleTooLong = tooLong('规则', rule, SCHEDULE_RULE_MAX_CHARS);
  if (ruleTooLong !== null) return { ok: false, error: ruleTooLong };
  // 语义判据只有一处：agent-core 的解析器。存一条永不触发的规则 = 静默失败
  const parsed = parseRule(rule);
  if (!parsed.ok) return { ok: false, error: `规则不行：${parsed.error}` };

  const prompt = textOf(raw, 'prompt');
  if (prompt === '') return { ok: false, error: '到点要交给模型的那句话不能是空的' };
  const promptTooLong = tooLong('提示词', prompt, SCHEDULE_PROMPT_MAX_CHARS);
  if (promptTooLong !== null) return { ok: false, error: promptTooLong };

  const connectionId = textOf(raw, 'connectionId');
  if (connectionId === '') return { ok: false, error: '要选一个模型连接：到点是它来回答，不是凭空生成' };

  const existing = ctx.existing ?? null;
  if (raw['id'] !== undefined && raw['id'] !== null && raw['id'] !== '') {
    if (typeof raw['id'] !== 'string' || !TASK_ID.test(raw['id'])) {
      return { ok: false, error: `任务标识不合法，拒绝当作路径使用：${String(raw['id']).slice(0, 80)}` };
    }
    if (existing === null) return { ok: false, error: `没有这条任务：${raw['id']}` };
  }

  const now = ctx.now ?? new Date();
  const id = existing?.id ?? randomUUID();
  const candidate: ScheduledTask = {
    id,
    name,
    rule,
    prompt,
    connectionId,
    // 锚点是"这条任务第一次可能被触发"的那一刻。改规则**不重算它**：
    // 否则把 09:00 改成 08:00 会凭空多出"今天 08:00 到 09:00"这笔欠账
    anchorAt: existing?.anchorAt ?? now.toISOString(),
    sessionId: existing?.sessionId ?? null,
    enabled: existing?.enabled ?? true,
    jitterMs: existing?.jitterMs ?? jitterOf(id),
    lastRunAt: existing?.lastRunAt ?? null,
    lastSkipped: existing?.lastSkipped ?? 0,
    lastError: existing?.lastError ?? '',
  };

  const checked = scheduledTaskSchema.safeParse(candidate);
  if (!checked.success) {
    return { ok: false, error: `任务形状不对：${checked.error.issues[0]?.message ?? '有字段不认识或超限'}` };
  }
  return { ok: true, task: checked.data };
}

/** 抖动按 id 派生（FNV-1a）并**落盘固定**：重启后换点就会被当成"这一次还没跑过"而重复补跑 */
function jitterOf(id: string): number {
  if (SCHEDULE_JITTER_WINDOW_MS <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % SCHEDULE_JITTER_WINDOW_MS;
}

interface TasksFile {
  tasks: ScheduledTask[];
}

type ReadAll = () => Promise<{ tasks: ScheduledTask[]; health: string }>;
type WriteAll = (tasks: ScheduledTask[]) => Promise<void>;

/**
 * 内核：内存版与文件版各自只供给 `readAll` / `writeAll`，
 * 校验、上限、临界区串行化都只有这一份。
 */
function createCore(readAll: ReadAll, writeAll: WriteAll, healthOf: () => string): ScheduleStore {
  let chain: Promise<void> = Promise.resolve();
  const onChain = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const find = (tasks: ScheduledTask[], id: string): ScheduledTask | undefined =>
    tasks.find((t) => t.id === id);

  return {
    list: () => onChain(async () => (await readAll()).tasks),

    get: (id) => onChain(async () => find((await readAll()).tasks, id) ?? null),

    health: () => onChain(async () => healthOf()),

    upsert: (input) =>
      onChain(async () => {
        const rawId = input !== null && typeof input === 'object' ? (input as { id?: unknown }).id : undefined;
        const hasId = typeof rawId === 'string' && rawId !== '';
        const current = (await readAll()).tasks;
        const target = hasId ? find(current, rawId as string) ?? null : null;
        if (!hasId && current.length >= MAX_SCHEDULED_TASKS) {
          return {
            ok: false,
            error: `定时任务最多 ${String(MAX_SCHEDULED_TASKS)} 条，先删掉不用的（改已有的一条不受这个数限制）`,
          };
        }
        const validated = validateTaskInput(input, { existing: target });
        if (!validated.ok) return validated;
        const rest = target === null ? current : current.filter((t) => t.id !== target.id);
        await writeAll([...rest, validated.task]);
        return { ok: true, task: validated.task };
      }),

    remove: (id) =>
      onChain(async () => {
        if (!TASK_ID.test(id)) return { ok: false, error: `任务标识不合法：${id.slice(0, 80)}` };
        const current = (await readAll()).tasks;
        if (find(current, id) === undefined) return { ok: false, error: `没有这条任务：${id}` };
        await writeAll(current.filter((t) => t.id !== id));
        return { ok: true, error: '' };
      }),

    setEnabled: (id, enabled) =>
      onChain(async () => {
        if (!TASK_ID.test(id)) return { ok: false, error: `任务标识不合法：${id.slice(0, 80)}` };
        const current = (await readAll()).tasks;
        if (find(current, id) === undefined) return { ok: false, error: `没有这条任务：${id}` };
        await writeAll(current.map((t) => (t.id === id ? { ...t, enabled } : t)));
        return { ok: true, error: '' };
      }),

    markRun: (id, mark) =>
      onChain(async () => {
        const current = (await readAll()).tasks;
        const found = find(current, id);
        if (found === undefined) return { ok: false, error: `没有这条任务：${id}` };
        const updated: ScheduledTask = {
          ...found,
          lastRunAt: mark.at,
          lastSkipped: Math.max(0, Math.floor(mark.skipped)),
          lastError: mark.error ?? '',
          sessionId: mark.sessionId !== undefined ? mark.sessionId : found.sessionId,
        };
        await writeAll(current.map((t) => (t.id === id ? updated : t)));
        return { ok: true, task: updated };
      }),
  };
}

/** 内存版（单测与"没选中工作区也要能看清账"的路径用；不碰磁盘） */
export function createMemoryScheduleStore(initial: ScheduledTask[] = []): ScheduleStore {
  let tasks = [...initial];
  return createCore(
    async () => ({ tasks: [...tasks], health: '' }),
    async (next) => {
      tasks = [...next];
    },
    () => '',
  );
}

export function scheduleFile(dataRoot: string): string {
  return join(dataRoot, 'schedules', 'tasks.json');
}

/**
 * 文件版。读盘**不抛穿调用方**：坏一份清单不该让整页打不开（R8 那次"整条列表 IPC 抛错"的教训），
 * 但必须把话说成 `health` 让界面显示出来 —— 静默当空表是另一种撒谎。
 */
export function createFileScheduleStore(dataRoot: string): ScheduleStore {
  const file = scheduleFile(dataRoot);
  const store = new JsonStore<TasksFile>(file, {
    version: 1,
    defaults: () => ({ tasks: [] }),
    validate: (input) => {
      const obj = input as Partial<TasksFile>;
      const list = Array.isArray(obj.tasks) ? obj.tasks : [];
      // 认不出的条目**这次不显示，但不改文件**：宁可少一条，也不许因为一条脏数据把整本账判空
      const ok = list.filter((t) => scheduledTaskSchema.safeParse(t).success) as ScheduledTask[];
      return { tasks: ok.slice(0, MAX_SCHEDULED_TASKS) };
    },
  });

  let lastHealth = '';
  const read = async (): Promise<{ tasks: ScheduledTask[]; health: string }> => {
    let detected: Awaited<ReturnType<typeof store.read>>;
    try {
      detected = await store.read();
    } catch (err) {
      lastHealth = `任务清单读不出来：${err instanceof Error ? err.message : String(err)}`;
      return { tasks: [], health: lastHealth };
    }
    const notes: string[] = [];
    if (detected.recovered) notes.push('任务清单是从备份或默认值回落的（主文件当时读不出）');
    const version = detected.detectedVersion;
    if (version !== undefined && version > 1) notes.push(`这份清单来自更新的版本（v${String(version)}）`);
    lastHealth = notes.join('；');
    return { tasks: detected.data.tasks, health: lastHealth };
  };

  const write = async (tasks: ScheduledTask[]): Promise<void> => {
    await mkdir(dirname(file), { recursive: true });
    await store.write({ tasks });
  };

  return createCore(read, write, () => lastHealth);
}
