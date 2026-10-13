import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 全局 setup（2026-10-13 补）：保证项目内 `.tmp/` 存在。
 *
 * 为什么必须有一处保证它：多个测试用 `mkdtemp(join(process.cwd(), '.tmp', …))` 建临时目录，
 * 而 `mkdtemp` **不会创建父目录** —— 两种情况都会让全量测试集体假红
 * （`ENOENT … .tmp\jujia-audit-XXXXXX`）：
 * ① 全新克隆上 `.tmp` 从来不存在；
 * ② 每个收口轮都会跑 `cleanup.py --apply` —— 它会把 `.tmp` **整只收进 `.trash`**。
 * 2026-10-13 当天第二次咬到之后，这里一次兜住，不靠任何人的记性。
 */
export default function setup(): void {
  const root = fileURLToPath(new URL('.', import.meta.url));
  mkdirSync(join(root, '.tmp'), { recursive: true });
}
