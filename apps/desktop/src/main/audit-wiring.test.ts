import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 执行审计的**接线锁**（M4 收尾 · 其二）。
 *
 * 单测已经证明每一段单独work；这里只回答一个问题：**这条链是不是真的从头接到尾**。
 * 审计最怕的失败形态不是"记错了"，而是"某一道门没接上" —— 那本账看起来完全正常，
 * 只是缺了最该在的那几行。所以链条上每一环都单独钉：
 *
 *   执行器出口 → 三条工具入口 → 主进程服务 → 两条通道 → preload → 界面卡片
 *
 * 判据一律**现扫源码**（不写死清单），钉的是"每一环都在"，不是"某一行长这样"。
 */

// 用 import.meta.url 而不是 __dirname：这个包是 ESM，__dirname 不存在（仓库里其他接线锁同一写法）
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** 去掉注释与字符串里的假命中：接线锁读的是代码，不是散文 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const EXECUTOR = stripComments(read('../../../../packages/agent-core/src/tools/executor.ts'));
const CHAT = stripComments(read('./ipc/chat.ts'));
const TOOLS = stripComments(read('./ipc/tools.ts'));
const CANVAS = stripComments(read('./ipc/canvas.ts'));
const IPC = stripComments(read('./ipc.ts'));
const PRELOAD = stripComments(read('../preload/index.ts'));
const PANEL = stripComments(read('../renderer/src/features/permissions/PermissionRulesPanel.tsx'));
const SERVICE = stripComments(read('./audit-service.ts'));
const INDEX = stripComments(read('./index.ts'));

describe('执行审计接线', () => {
  it('出口只有一个：在 runTool 外层的 finally 里，不在各条 return 前面', () => {
    // 每加一条提前返回就少记一行 = 这本账会悄悄缺页；放 finally 才是结构性的"一条不落"
    expect(EXECUTOR).toContain('} finally {');
    const emitted = (EXECUTOR.match(/onDecision\(/g) ?? []).length;
    expect(emitted).toBe(1);
  });

  it('三条工具入口都接了同一个服务（对话 / 手动执行 / 画布）', () => {
    for (const [name, src] of [['对话', CHAT], ['手动执行', TOOLS], ['画布', CANVAS]] as const) {
      expect(src, name).toContain('onDecision');
      expect(src, name).toContain('.recordTool(');
    }
  });

  it('入口不自己判定，只把判定原样交给服务（不许在这里加工一遍）', () => {
    for (const src of [CHAT, TOOLS, CANVAS]) {
      expect(src).not.toContain('summarizeArgs(');
      expect(src).not.toContain('makeRecord(');
    }
    // 剔密与记账形状只在 audit-service 一处
    expect(SERVICE).toContain('summarizeArgs(');
    expect(SERVICE).toContain('makeRecord(');
  });

  it('审计的两条通道注册齐了，preload 也备好了读与导出', () => {
    expect(IPC).toContain('registerAuditIpc(ctx)');
    expect(PRELOAD).toContain('auditTail');
    expect(PRELOAD).toContain('auditExport');
  });

  it('界面上有"执行审计"这一卡，且写明尚未接入的那三个门', () => {
    expect(PANEL).toContain('执行审计');
    expect(PANEL).toContain('auditTail');
    expect(PANEL).toContain('auditExport');
    // 半本账不许看起来像全账
    expect(PANEL).toContain('尚未接入');
  });

  it('渲染进程崩溃也收尾挂起的审批（T38）', () => {
    const goneIdx = INDEX.indexOf("'render-process-gone'");
    expect(goneIdx).toBeGreaterThan(-1);
    expect(INDEX.slice(goneIdx, goneIdx + 420)).toContain('permissionBridge.cancelAll(');
  });
});
