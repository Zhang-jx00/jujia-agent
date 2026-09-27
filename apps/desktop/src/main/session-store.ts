import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import { getDataRoot } from './paths';

/**
 * 会话持久化（轨道铺设计划 6 · 6a）。
 *
 * 布局按 `docs/PLAN.md §3.3` 原定图纸，不另定（批复 ①）：
 *   <数据根>/sessions/index.json                    会话清单（缓存，缺失时由目录重建）
 *   <数据根>/sessions/<sessionId>/session.meta.json 单会话元信息（原子写 + .bak）
 *   <数据根>/sessions/<sessionId>/messages.jsonl    append-only，一行一条
 *
 * **三条不可让的规矩，都写在这一个文件里**：
 * 1. **sessionId 只能经 `sessionDir()` 变成路径**。它不匹配白名单就直接抛 ——
 *    这是 M6 那条经验（守卫放进被守卫的代码里面）的第二次应用：不指望每个调用点记得校验。
 * 2. **JSONL 只追加完整行**，所以进程中途死最多丢最后一条。读到不完整行 → 丢掉并在结果里报告，
 *    绝不"尽力解析"（把看不懂的行当没有 = 悄悄删用户数据）。
 * 3. **不存的东西比存什么更重要**：工具输出只存截断摘要 + 涉及路径（②，敏感内容不留第二份持久副本），
 *    apiKey / 请求头 / 完整 query 永不入库。
 */

/** 现有会话 id 全部来自 `randomUUID()`，形态固定；白名单按这个形态收紧 */
const SESSION_ID = /^[a-z0-9-]{6,64}$/;

export const SESSION_SCHEMA_VERSION = 1;
/** 单条消息入库上限：超了截断并如实标注（与 read_file 的截断纪律同一形状） */
export const STORED_MESSAGE_MAX_CHARS = 4_000;

export type StoredRole = 'system' | 'user' | 'assistant' | 'tool';

export interface StoredToolCall { id: string; name: string; argumentsText: string }

export interface StoredMessage {
  v: number;
  t: string;
  role: StoredRole;
  content: string;
  toolCallId?: string;
  toolCalls?: StoredToolCall[];
}

export interface SessionMeta {
  id: string;
  connectionId: string;
  /** 首条用户消息的前若干字，供界面列表当标题用（截断，不存全文） */
  title: string;
  createdAt: string;
  lastUsedAt: string;
  messageCount: number;
  /** 6b 才会用到：已压缩到的位置。6a 恒为 0，字段先立住避免下次改格式 */
  compactedThrough: number;
}

export interface SessionLoad {
  messages: StoredMessage[];
  /** 读到最后一条残缺行时被丢弃的字节数（0 = 文件完好） */
  droppedTailBytes: number;
}

/** 会话 id → 目录。**校验只有这一处**：任何"拿 id 拼路径"的代码都算绕过。 */
export function sessionDir(sessionsRoot: string, id: string): string {
  if (!SESSION_ID.test(id)) {
    throw new Error(`[sessions] 会话标识不合法，拒绝当作路径使用：${JSON.stringify(id.slice(0, 80))}`);
  }
  return join(sessionsRoot, id);
}

/** 会话根目录 → 单条消息文件路径（同样只经 `sessionDir`） */
export function messagesFile(sessionsRoot: string, id: string): string {
  return join(sessionDir(sessionsRoot, id), 'messages.jsonl');
}

/** 入库前的最后一道整形：压成单行、限长并**如实标注**截断 */
export function toStoredMessage(
  role: StoredRole,
  content: string,
  now: Date = new Date(),
  extra: { toolCallId?: string; toolCalls?: StoredToolCall[] } = {},
): StoredMessage {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  const clipped =
    oneLine.length > STORED_MESSAGE_MAX_CHARS
      ? `${oneLine.slice(0, STORED_MESSAGE_MAX_CHARS)}…（已截断，原 ${String(oneLine.length)} 字）`
      : oneLine;
  return {
    v: SESSION_SCHEMA_VERSION,
    t: now.toISOString(),
    role,
    content: clipped,
    ...(extra.toolCallId !== undefined ? { toolCallId: extra.toolCallId } : {}),
    ...(extra.toolCalls !== undefined ? { toolCalls: extra.toolCalls } : {}),
  };
}

export interface SessionStore {
  list(): Promise<SessionMeta[]>;
  load(id: string): Promise<SessionLoad>;
  append(id: string, messages: StoredMessage[]): Promise<void>;
  saveMeta(meta: SessionMeta): Promise<void>;
}

interface IndexFile { sessions: SessionMeta[] }

/**
 * 从磁盘上的目录重建清单。
 * `index.json` 只当缓存用：损坏 / 丢失时不报错、不丢会话，扫目录即可恢复（目录才是事实）。
 */
async function rebuildIndex(sessionsRoot: string): Promise<SessionMeta[]> {
  const ids = await readdir(sessionsRoot).catch(() => [] as string[]);
  const metas: SessionMeta[] = [];
  for (const id of ids) {
    if (!SESSION_ID.test(id)) continue; // 不认识的名字直接跳过（不猜、不报错卡死）
    try {
      const raw = await readFile(join(sessionDir(sessionsRoot, id), 'session.meta.json'), 'utf8');
      const parsed = JSON.parse(raw) as { data?: SessionMeta };
      const meta = parsed.data ?? (parsed as SessionMeta);
      if (meta && typeof meta.id === 'string') metas.push(meta);
    } catch {
      // 元信息读不出来：目录留着（用户数据不删），只是列表里不显示它
    }
  }
  return metas.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export function createSessionStore(sessionsRoot: string): SessionStore {
  const index = new JsonStore<IndexFile>(join(sessionsRoot, 'index.json'), {
    version: SESSION_SCHEMA_VERSION,
    defaults: () => ({ sessions: [] }),
    validate: (input) => {
      const obj = input as IndexFile;
      if (!Array.isArray(obj.sessions)) throw new Error('sessions/index.json 结构非法');
      return { sessions: obj.sessions };
    },
  });

  const writeMessages = async (id: string, messages: StoredMessage[]): Promise<void> => {
    const dir = sessionDir(sessionsRoot, id);
    await mkdir(dir, { recursive: true });
    const body = messages.map((m) => JSON.stringify(m)).join('\n');
    if (body === '') return;
    // 先写临时文件再原子改名？不 —— JSONL 的语义就是"只追加完整行"，
    // 用 appendFile 一次写入本轮全部行，崩溃最多留下最后一条残缺行，由 load() 丢弃并报告。
    await appendFile(join(dir, 'messages.jsonl'), `${body}\n`, 'utf8');
  };

  /**
   * 清单写入**串行化**（外部审查 T6③）：`upsertIndex` 是"读—改—写"，
   * 两个会话同时落盘时若无序交错，后写的会把前写的覆盖掉（丢的是清单条目，不是消息）。
   * 关键是把**读也放进临界区**：只串行化写，两次"读到的旧状态"仍然会互相抹掉
   * —— 这个错误是被并发那条用例当场抓出来的，不是靠想。
   * 单进程内一条 Promise 链就够；不必引入锁库。
   */
  let indexTail: Promise<void> = Promise.resolve();

  /** 把一个动作挂到清单的串行链尾部；返回的 Promise 仍会把错误如实交给调用方 */
  const onIndexChain = <T>(task: () => Promise<T>): Promise<T> => {
    const step = indexTail.then(task);
    indexTail = step.then(
      () => undefined,
      () => undefined,
    );
    return step;
  };

  const upsertIndex = (meta: SessionMeta): Promise<void> =>
    onIndexChain(async () => {
      const { data } = await index.read();
      const rest = data.sessions.filter((s) => s.id !== meta.id);
      await index.write({ sessions: [meta, ...rest].slice(0, 500) });
    });

  const saveMeta = async (meta: SessionMeta): Promise<void> => {
    const dir = sessionDir(sessionsRoot, meta.id);
    await mkdir(dir, { recursive: true });
    const store = new JsonStore<SessionMeta>(join(dir, 'session.meta.json'), {
      version: SESSION_SCHEMA_VERSION,
      defaults: () => meta,
      validate: (input) => input as SessionMeta,
    });
    await store.write(meta);
    await upsertIndex(meta);
  };

  return {
    list: async () => {
      const { data, source } = await index.read();
      const known = data.sessions.filter((s) => SESSION_ID.test(s.id));
      if (source !== 'default' && known.length > 0) {
        return known.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
      }
      /**
       * 缓存缺失 / 损坏 / 一条有效记录都没有 → 以**目录**为准重建，并把结果写回（T6③）。
       * 以前只重建不写回：于是"用户手删 index.json"之后，每次列会话都要重扫全目录，
       * 而那份缓存永远不再存在 —— 看似无害，实际是把"目录是事实"偷换成了"每次现算"，
       * 会话一多就会真的变慢。写回之后这条路径只贵一次。
       */
      const rebuilt = await rebuildIndex(sessionsRoot);
      await onIndexChain(() => index.write({ sessions: rebuilt })).catch((err: unknown) => {
        console.warn('[sessions] 清单写回失败（下一次列会话会再重建一次）：', err);
      });
      return rebuilt;
    },

    load: async (id) => {
      const path = messagesFile(sessionsRoot, id);
      const raw = await readFile(path, 'utf8').catch(() => '');
      if (raw === '') return { messages: [], droppedTailBytes: 0 };
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      const messages: StoredMessage[] = [];
      let droppedTailBytes = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        let parsed: StoredMessage | null = null;
        let failure: unknown = null;
        try {
          parsed = JSON.parse(line) as StoredMessage;
        } catch (err) {
          failure = err;
        }
        if (parsed === null) {
          const isLast = i === lines.length - 1;
          // 只有**最后一条**允许残缺（进程写一半被杀就是这种形状）；中间坏掉不能用它解释
          if (!isLast) {
            throw new Error(
              `[sessions] ${id} 的第 ${String(i + 1)} 行损坏（不是末行，无法用"丢弃最后一条"解释）`,
              { cause: failure },
            );
          }
          droppedTailBytes = Buffer.byteLength(line, 'utf8');
          continue;
        }
        // 来自更新版本的行：不猜格式，整条停读并报出来（悄悄丢数据比报错糟得多）
        if (typeof parsed.v === 'number' && parsed.v > SESSION_SCHEMA_VERSION) {
          throw new Error(`[sessions] ${id} 含未来版本（v=${String(parsed.v)}）的行，当前实现不会尽力解析`);
        }
        messages.push(parsed);
      }
      return { messages, droppedTailBytes };
    },

    append: async (id, messages) => {
      await writeMessages(id, messages);
    },

    saveMeta,
  };
}

/** 真实运行时用：数据根下的 sessions/ 目录 */
export function createFileSessionStore(): SessionStore {
  return createSessionStore(join(getDataRoot(), 'sessions'));
}
