import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 「测试不写系统盘」的**行为锁**（复核 017）。
 *
 * 为什么用扫源码这种形式：这条策略落在**脚本**里（启动器、e2e 脚本、清理脚本、忽略规则），
 * 没有函数可以被单测直接调用；而它一旦退化，后果是"测试又悄悄往 C 盘写东西"——
 * 没人会立刻发现。把不变量固定成清单，边界一动测试就失败。
 *
 * 需要同时满足两条才算真隔离（只挪一条 = 另一条还在 C 盘）：
 * 1. 应用自己的数据根 → `JUJIA_DATA_BASE_DIR`
 * 2. Electron 的配置/缓存 → `--user-data-dir`
 */

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const runElectron = read('../../scripts/run-electron.mjs');
const e2e = read('../../scripts/e2e-ui.mjs');
const gitignore = read('../../../../.gitignore');
const cleanupPy = read('../../../../scripts/cleanup.py');

describe('测试临时文件不落系统盘（C 盘）', () => {
  it('启动器在测试模式下同时挪走「数据根」与「Electron 配置目录」', () => {
    expect(runElectron).toContain('JUJIA_DATA_BASE_DIR');
    expect(runElectron).toContain('--user-data-dir=');
    // 只对测试模式生效：日常使用（npm run app / dev）应当用你自己的数据目录
    expect(runElectron).toContain("a === '--smoke' || a === '--perf'");
  });

  it('启动器把测试目录放在**项目内** .tmp/（跟着仓库所在盘，不写系统盘）', () => {
    expect(runElectron).toContain("'.tmp'");
    expect(runElectron).toContain('[run-electron]');
  });

  it('界面级 e2e 也用项目内 .tmp/，并显式传 --user-data-dir', () => {
    expect(e2e).toContain("'.tmp'");
    expect(e2e).toContain('--user-data-dir=');
    // 不能再用系统临时目录（在别的机器上那可能就是 C 盘）
    expect(e2e).not.toContain('tmpdir()');
  });

  it('.tmp/ 既不入库、也在清理脚本的覆盖范围内', () => {
    expect(gitignore).toContain('.tmp/');
    expect(cleanupPy).toContain('".tmp"');
  });
});
