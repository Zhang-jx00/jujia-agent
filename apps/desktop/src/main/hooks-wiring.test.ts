import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 钩子配置写入（外部审查 T4）的接线锁。
 *
 * 为什么光有 `hooks-gate.test.ts` 不够：判档函数是纯函数，它可以全绿而**根本没人调用** ——
 * 这正是 W10g 那次的形状（策略层写好了、测好了，执行器却没接）。
 * 所以这里钉的是"处理器真的过门"这一件事实：
 * ① 唯一的写盘入口 `hooks.save(` 前必须有判档与自证；
 * ② 全仓只有这一处能写钩子配置（多一处 = 多一条不走门的旁路）；
 * ③ 没有"记住这次决定"的白名单 —— 硬 ask 的意义就是每次都要过人手。
 */

const here = dirname(fileURLToPath(import.meta.url));

const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ext = strip(readFileSync(join(here, 'ipc', 'extensions.ts'), 'utf8'));
const gate = strip(readFileSync(join(here, 'hooks-gate.ts'), 'utf8'));

describe('HOOKS_SET 真的过权限门', () => {
  it('判档 + 自证 + 弹窗三件都在，且都发生在写盘之前', () => {
    const saveAt = ext.indexOf('hooks.save(');
    expect(saveAt).toBeGreaterThan(-1);
    for (const needle of [
      'decideHooksModify(',
      'assertHooksHardAskInert(gate)',
      'permission.resolve(request)',
    ]) {
      const at = ext.indexOf(needle);
      expect(at, needle).toBeGreaterThan(-1);
      expect(at, `${needle} 必须出现在 hooks.save 之前`).toBeLessThan(saveAt);
    }
  });

  it('全仓只有 extensions.ts 这一处写钩子配置（多一处就是多一条不走门的旁路）', () => {
    expect(ext.split('hooks.save(').length - 1).toBe(1);
  });

  it('没有"总是允许"白名单：这个模块里不允许出现 remembered / alwaysAllow', () => {
    expect(ext).not.toMatch(/remembered|alwaysAllow/);
  });

  it('deny 与 timeout 各有一条返回，且都不落盘（拒绝必须真的不做）', () => {
    expect(ext).toContain("'deny' || decision === 'timeout'");
    expect(ext).toContain('钩子配置未改动');
  });

  it('判档走的是引擎同一个 decideGate，不抄第二套口径', () => {
    expect(gate).toContain('decideGate(');
    expect(gate.split('decideGate(').length - 1).toBe(1);
    // 硬 ask 的落地点：拿到 ask 之后把档口改成不可压
    expect(gate).toContain('if (gate.action === \'ask\') return { ...gate, bypassable: false };');
  });

  it('弹窗摘要带出将要写入的命令（审批看不到内容等于没有审批）', () => {
    expect(ext).toContain('hookCommandsOf(input)');
    expect(ext).toContain('args: { path: configPath, config: input }');
  });
});
