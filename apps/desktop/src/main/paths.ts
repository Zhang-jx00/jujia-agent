import { join } from 'node:path';
import { app } from 'electron';

/**
 * 数据根目录（规划见 docs/PLAN.md §3.3）。
 * 统一出口，禁止在业务代码里散落 `app.getPath('userData')`。
 *
 * `JUJIA_DATA_BASE_DIR` 可以把数据根挪到别处（**直接作为数据根**，不再追加 `JuJiaData`）：
 * - 自动化测试要一份干净、可丢弃的数据目录，绝不能碰你日常那套数据；
 * - 想并行跑"开发态"和"尝鲜态"两个实例时，也用它隔离。
 */
export function getDataRoot(): string {
  const override = process.env['JUJIA_DATA_BASE_DIR'];
  if (typeof override === 'string' && override.trim() !== '') return override;
  return join(app.getPath('userData'), 'JuJiaData');
}
