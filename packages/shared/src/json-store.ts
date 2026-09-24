import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * 原子 JSON 存储（知识卡片 003 的落地实现）。
 *
 * 设计要点（每条都对应具体事故场景）：
 * 1. **先写临时文件再 rename**：rename 在同分区是原子操作，避免出现「半截 JSON」；
 * 2. **fsync 后再 rename**：否则断电/强杀时可能 rename 了但内容还在页缓存里 → 目标文件为空；
 * 3. **覆盖前把旧文件转 .bak**：写坏或 schema 升级失败时可回滚到上一版；
 * 4. **读取失败自动降级**：主文件损坏 → 读 .bak → 用默认值并标记 recovered，绝不抛崩；
 * 5. **同路径写入串行化**：避免两个 action 并发写导致后写覆盖先写（配置竞态会让用户的设置静默丢失）；
 * 6. **带 version 信封**：schema 变更时可识别旧版本并走 migrate。
 */

export interface Envelope<T> {
  version: number;
  updatedAt: string;
  data: T;
}

export type ReadSource = 'primary' | 'backup' | 'default';

export interface ReadResult<T> {
  data: T;
  source: ReadSource;
  /** 主文件损坏但已恢复（来自 .bak 或默认值），调用方应提示用户 */
  recovered: boolean;
  /** 探测到的原始版本号（来自信封；无信封时为 undefined） */
  detectedVersion?: number;
}

export interface StoreOptions<T> {
  /** 当前 schema 版本，写入时写入信封 */
  version: number;
  /** 主文件与备份都不可用时的默认值 */
  defaults: () => T;
  /** 校验并收窄类型（通常传 zod 的 parse），失败视为数据不可用 */
  validate?: (input: unknown) => T;
  /** 旧版本数据迁移：返回迁移后的数据（仍会再走 validate） */
  migrate?: (fromVersion: number, data: unknown) => unknown;
}

/** 按绝对路径串行化写入，避免并发覆盖 */
const writeQueues = new Map<string, Promise<void>>();

function enqueue(path: string, task: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(path) ?? Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(
    path,
    next.catch(() => undefined),
  );
  return next;
}

const isEnvelope = (v: unknown): v is Envelope<unknown> =>
  typeof v === 'object' && v !== null && 'version' in v && 'data' in v;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** 原子写：tmp → fsync → (旧文件转 .bak) → rename */
export async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const target = resolve(filePath);
  return enqueue(target, async () => {
    await mkdir(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${Date.now()}-${process.pid}.tmp`);
    const body = `${JSON.stringify(payload, null, 2)}\n`;

    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync(); // 落盘，防止「rename 成功但内容丢失」
    } finally {
      await handle.close();
    }

    if (await exists(target)) {
      // 复核发现（2026-09-18 第二遍）：若主文件已损坏，把它 rename 成 .bak 会用垃圾
      // 覆盖掉本来健康的备份，等于亲手毁掉唯一的救援副本。
      // 因此只在主文件可解析时才转存 .bak；损坏文件改名为 .corrupt-<ts> 留证。
      if (await isParseableJsonFile(target)) {
        await rename(target, `${target}.bak`);
      } else {
        const quarantine = `${target}.corrupt-${Date.now()}`;
        await rename(target, quarantine);
        console.warn(`[json-store] 主文件损坏，已隔离为 ${quarantine}，保留原 .bak 不被覆盖`);
      }
    }

    try {
      await rename(tmp, target);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  });
}

/** 判断文件是否存在且可被 JSON.parse（用于决定是否值得转存为备份） */
async function isParseableJsonFile(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.trim() === '') return false;
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

async function readCandidate<T>(
  path: string,
  opts: StoreOptions<T>,
): Promise<{ data: T; version?: number } | undefined> {
  if (!(await exists(path))) return undefined;
  const raw = await readFile(path, 'utf8');
  if (raw.trim() === '') return undefined;

  const parsed: unknown = JSON.parse(raw);
  let payload: unknown = parsed;
  let version: number | undefined;

  if (isEnvelope(parsed)) {
    version = parsed.version;
    payload = parsed.data;
    if (opts.migrate && version < opts.version) {
      payload = opts.migrate(version, payload);
      version = opts.version;
    }
  }

  const data = opts.validate ? opts.validate(payload) : (payload as T);
  return { data, ...(version === undefined ? {} : { version }) };
}

/** 读取：主 → 备 → 默认值，任何一步失败都不会抛崩调用方 */
export async function readJsonSafe<T>(filePath: string, opts: StoreOptions<T>): Promise<ReadResult<T>> {
  const target = resolve(filePath);
  const problems: string[] = [];

  for (const [path, source] of [
    [target, 'primary'],
    [`${target}.bak`, 'backup'],
  ] as const) {
    try {
      const hit = await readCandidate(path, opts);
      if (hit) {
        return {
          data: hit.data,
          source,
          recovered: source !== 'primary',
          ...(hit.version === undefined ? {} : { detectedVersion: hit.version }),
        };
      }
    } catch (err) {
      problems.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (problems.length > 0) {
    console.warn(`[json-store] ${target} 读取失败，已回退默认值 → ${problems.join(' | ')}`);
  }
  return { data: opts.defaults(), source: 'default', recovered: problems.length > 0 };
}

/** 便捷封装：把某个 JSON 文件当对象用 */
export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly opts: StoreOptions<T>,
  ) {}

  get path(): string {
    return resolve(this.filePath);
  }

  async read(): Promise<ReadResult<T>> {
    return readJsonSafe(this.filePath, this.opts);
  }

  async write(data: T): Promise<void> {
    const envelope: Envelope<T> = {
      version: this.opts.version,
      updatedAt: new Date().toISOString(),
      data,
    };
    await atomicWriteJson(this.filePath, envelope);
  }

  /** 读 → 改 → 写。回调拿到的是可安全修改的副本语义（调用方自行保证不并发改同一份）。 */
  async update(mutate: (current: T) => T): Promise<T> {
    const { data } = await this.read();
    const next = mutate(data);
    await this.write(next);
    return next;
  }
}

/** 测试/迁移用：清空写队列，避免用例之间互相等待 */
export function __resetWriteQueues(): void {
  writeQueues.clear();
}

/** 供测试断言用：写入同一路径时是否确实串行 */
export function writeQueueSize(): number {
  return writeQueues.size;
}
