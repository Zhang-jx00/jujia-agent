import { describe, expect, it } from 'vitest';
import {
  appendHookDiagnostics,
  HOOK_DIAGNOSTIC_MAX_LINES,
  HOOK_DIAGNOSTIC_MARKER,
  hookDiagnosticsNotice,
} from './notice';

/**
 * T51：钩子的 diagnostics 怎么念出口，只在这一处定义。
 *
 * 这里刻意有"反向对照"用例 —— 没有诊断时**不许**冒出标记行。
 * 一个每次都写着"钩子诊断"的界面，用户三遍之后就当背景纹看了（本项目反复栽的"提示疲劳"）。
 */
describe('钩子诊断的出口形状（T51）', () => {
  it('工具结果追加诊断：每条一行，带统一标记', () => {
    const out = appendHookDiagnostics('读取完成', ['会话开始钩子: 超时 5000ms 已被终止', '另一个: stderr —— boom']);

    expect(out.startsWith('读取完成')).toBe(true);
    expect(out).toContain(HOOK_DIAGNOSTIC_MARKER);
    expect(out).toContain('- 会话开始钩子: 超时 5000ms 已被终止');
    expect(out).toContain('- 另一个: stderr —— boom');
  });

  it('没有诊断时一个字都不加（不许留空标记）', () => {
    expect(appendHookDiagnostics('读取完成', [])).toBe('读取完成');
    expect(hookDiagnosticsNotice([])).toBe('');
  });

  it('诊断条数有上界：超出的如实说"还有几条没念出来"，而不是无限铺开', () => {
    const many = Array.from({ length: HOOK_DIAGNOSTIC_MAX_LINES + 3 }, (_, i) => `第 ${String(i)} 条`);
    const out = appendHookDiagnostics('结果', many);

    for (let i = 0; i < HOOK_DIAGNOSTIC_MAX_LINES; i += 1) expect(out).toContain(`第 ${String(i)} 条`);
    expect(out).not.toContain(`第 ${String(HOOK_DIAGNOSTIC_MAX_LINES + 2)} 条`);
    expect(out).toContain('还有 3 条没念出来');
  });

  it('回合级那句：以标记开头，多条用分号连（与 done 提示那一格同形）', () => {
    const line = hookDiagnosticsNotice(['A: 启动失败', 'B: 不是合法 JSON']);

    expect(line.startsWith(HOOK_DIAGNOSTIC_MARKER)).toBe(true);
    expect(line).toContain('A: 启动失败；B: 不是合法 JSON');
  });

  it('回合级那句同样受条数上界约束', () => {
    const many = Array.from({ length: HOOK_DIAGNOSTIC_MAX_LINES + 2 }, (_, i) => `x${String(i)}`);
    const line = hookDiagnosticsNotice(many);

    expect(line).toContain('还有 2 条没念出来');
    expect(line).not.toContain(`x${String(HOOK_DIAGNOSTIC_MAX_LINES + 1)}`);
  });
});
