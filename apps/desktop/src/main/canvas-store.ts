import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonStore, atomicWriteJson } from '@jujia/shared';
import {
  CANVAS_GRAPH_VERSION,
  CANVAS_MAX_FILE_BYTES,
  canvasGraphSchema,
  migrateGraph,
  type CanvasGraph,
  type CanvasListItem,
} from '@jujia/shared-ipc';

/**
 * 画布图的持久化（M9a，报备 §三：**json-store 同源**，不另造一套存储）。
 *
 * 三条规矩（都从既有模块抄来的教训，不是新发明的）：
 * 1. **id 只能经白名单变成路径** —— `../escape` 这类必须在拼路径之前就被拒
 *    （与 `session-store.ts` 同一处纪律：守卫放在被守卫的代码里面，不指望调用点记得）；
 * 2. **迁移挂 `JsonStore` 自己的 migrate**（信封版本）与 `migrateGraph`（图自己的版本）——
 *    两层版本号是两件事：前者管文件格式，后者管图的内容；
 * 3. **空图不许覆盖已有图**：空白内容写下去等于把用户的图抹了（与"空摘要不落盘"同一条底线）。
 */

/** 现有图 id 全部来自 `randomUUID()`；白名单按这个形态收紧 */
const CANVAS_ID = /^[a-z0-9-]{6,64}$/;

function assertId(id: string): void {
  if (!CANVAS_ID.test(id)) {
    throw new Error(`[canvas] 图标识不合法，拒绝当作路径使用：${JSON.stringify(id.slice(0, 80))}`);
  }
}

export function canvasFile(root: string, id: string): string {
  assertId(id);
  return join(root, `${id}.json`);
}

export interface CanvasStore {
  list(): Promise<CanvasListItem[]>;
  load(id: string): Promise<{ ok: true; graph: CanvasGraph } | { ok: false; error: string }>;
  save(id: string, input: unknown): Promise<{ ok: true } | { ok: false; error: string }>;
}

const storeOf = (root: string, id: string): JsonStore<unknown> =>
  new JsonStore<unknown>(canvasFile(root, id), {
    version: 1,
    defaults: () => null,
    // 信封迁移：文件格式的版本（与图内容自己的 version 是两件事）
    migrate: (_from, data) => data,
  });

/** 列表项的"名字"：第一个节点的提示词（或工具名）前 40 字 —— 列表只是索引，不存全文 */
function nameOf(graph: CanvasGraph): string {
  const first = graph.nodes[0];
  if (first === undefined) return '（空图）';
  const raw =
    first.kind === 'prompt' ? String(first.config['prompt'] ?? '') : String(first.config['toolName'] ?? '');
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine === '' ? '（未命名）' : oneLine.slice(0, 40);
}

export function createCanvasStore(root: string): CanvasStore {
  return {
    async list(): Promise<CanvasListItem[]> {
      const names = await readdir(root).catch(() => [] as string[]);
      const items: CanvasListItem[] = [];
      for (const file of names) {
        if (!file.endsWith('.json')) continue;
        const id = file.slice(0, -'.json'.length);
        if (!CANVAS_ID.test(id)) continue; // 不认识的名字直接跳过（不猜、不报错卡死）
        // 列表要显示"什么时候改的"，而它写在**信封**上（`JsonStore.read` 只回 data）——
        // 所以这里原样读一次文件自己解信封；解不出来就当这张图坏了、不进列表（但也不删它）
        const env = await readEnvelope(root, file);
        if (env === null) continue;
        const migrated = migrateGraph(graphVersionOf(env.data), env.data);
        if (!migrated.ok) continue;
        items.push({
          id,
          name: nameOf(migrated.graph),
          nodeCount: migrated.graph.nodes.length,
          updatedAt: env.updatedAt,
        });
      }
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async load(id) {
      try {
        canvasFile(root, id); // 白名单先过（非法 id 在这里就抛，不会变成任意路径读）
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      const loaded = await storeOf(root, id).read();
      if (loaded.data === null) {
        // T40（R23）：**损坏 ≠ 没有** —— 读不出来时说"读不出来"，别把坏文件报成"图不存在"
        // （旧写法两者同一句话；用户会以为图丢了，其实是文件坏了、原件还在盘上）
        return {
          ok: false,
          error: loaded.recovered
            ? `这张图读不出来（文件损坏？原件保留在磁盘上，未删除）：${id}`
            : `没有这张图：${id}`,
        };
      }
      const migrated = migrateGraph(graphVersionOf(loaded.data), loaded.data);
      if (!migrated.ok) return { ok: false, error: migrated.error };
      return { ok: true, graph: migrated.graph };
    },

    async save(id, input) {
      try {
        canvasFile(root, id); // 先过白名单（非法 id 在这里抛，不会变成一次任意路径写）
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      const parsed = canvasGraphSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: '图的形状不合法（版本对但字段不对）' };
      }
      const bytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf8');
      if (bytes > CANVAS_MAX_FILE_BYTES) {
        return { ok: false, error: `这张图 ${String(Math.round(bytes / 1024))} KB，超过上限 ${String(CANVAS_MAX_FILE_BYTES / 1024)} KB` };
      }
      const file = canvasFile(root, id);
      // 原子写走 json-store 的同一台机器（tmp → fsync → 旧文件转 .bak → rename）——
      // 旧写法是裸 writeFile：文件头自称"json-store 同源"，实现却差一步（T40 审计项，R23 修）。
      const envelope = { version: 1, updatedAt: new Date().toISOString(), data: parsed.data };
      await atomicWriteJson(file, envelope);
      return { ok: true };
    },
  };
}

/**
 * 原样读一次文件、解出信封里那两样（`updatedAt` 与 `data`）。
 * 解不出来返回 null —— 交给调用方决定"跳过"（**不删**用户的文件）。
 */
async function readEnvelope(
  root: string,
  file: string,
): Promise<{ updatedAt: string; data: unknown } | null> {
  const raw = await readFile(join(root, file), 'utf8').catch(() => '');
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown; data?: unknown };
    return { updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '', data: parsed.data ?? null };
  } catch {
    return null;
  }
}

/** 图内容自己的版本号（读不出来就按当前版本交给 schema 判 —— 由 schema 去拒） */
function graphVersionOf(data: unknown): number {
  if (data !== null && typeof data === 'object' && 'version' in data) {
    const v = (data as { version?: unknown }).version;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  }
  return CANVAS_GRAPH_VERSION;
}

/** 真实运行时：数据根下的 canvas/ 目录 */
export function defaultCanvasRoot(dataRoot: string): string {
  return join(dataRoot, 'canvas');
}
