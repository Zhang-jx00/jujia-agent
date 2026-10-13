import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import { getDataRoot } from './paths';
import { SESSION_SCHEMA_VERSION, sessionDir } from './session-store';
import { validateTaskRecord, type TaskRecord } from './task-state';

/**
 * 任务记录的落盘（M17 批一 · R15）。
 *
 * 三条口径（设计见 `docs/DESIGN-M17.md` §二）：
 * - **与会话同目录**（`sessions/<id>/task.json`）：会话被搬走/清掉时记录跟着走，
 *   路径只经 `sessionDir()` 一处 —— 会话 id 白名单守卫在这里同样生效；
 * - **复用 json-store**（tmp→fsync→rename + `.bak`），与 `session.meta.json` 同一套写法；
 * - **读不出来 = 没有记录**：没跑过任务的会话、坏文件、表外形状都返回 null（不抛）——
 *   打开会话这条路径不能被一条烂记录崩掉。
 */

export function taskFile(sessionsRoot: string, id: string): string {
  return join(sessionDir(sessionsRoot, id), 'task.json');
}

export interface TaskStore {
  /** null = 没有（或读不出）任务记录 */
  read(id: string): Promise<TaskRecord | null>;
  write(id: string, record: TaskRecord): Promise<void>;
}

export function createTaskStore(sessionsRoot: string): TaskStore {
  // 每个会话一个 JsonStore（同路径写入由 json-store 内部排队，串行化不用再造）
  const stores = new Map<string, JsonStore<TaskRecord | null>>();
  const storeFor = (id: string): JsonStore<TaskRecord | null> => {
    let s = stores.get(id);
    if (s === undefined) {
      s = new JsonStore<TaskRecord | null>(taskFile(sessionsRoot, id), {
        version: SESSION_SCHEMA_VERSION,
        defaults: () => null,
        validate: (input) => (input === null ? null : validateTaskRecord(input)),
      });
      stores.set(id, s);
    }
    return s;
  };

  return {
    async read(id) {
      // taskFile/sessionDir 的守卫在 storeFor 里先把非法 id 拦掉（这里读不出来的都当没有）
      return (await storeFor(id).read()).data;
    },
    async write(id, record) {
      await storeFor(id).write(record);
    },
  };
}

/** 进程级单例 + 懒建（与 chat-service 的 store() 同一理由：模块加载期不能碰 electron 的 userData） */
let storeRef: TaskStore | null = null;

export function taskStore(): TaskStore {
  if (storeRef === null) storeRef = createTaskStore(join(getDataRoot(), 'sessions'));
  return storeRef;
}

/** 测试注入（含传 null 恢复"第一次用时再建"的行为） */
export function __setTaskStoreForTests(injected: TaskStore | null): void {
  storeRef = injected;
}
