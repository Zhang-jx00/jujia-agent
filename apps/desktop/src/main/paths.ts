import { join } from 'node:path';
import { app } from 'electron';

/**
 * 数据根目录（规划见 docs/PLAN.md §3.3）。
 * 统一出口，禁止在业务代码里散落 app.getPath('userData')。
 */
export function getDataRoot(): string {
  return join(app.getPath('userData'), 'JuJiaData');
}
