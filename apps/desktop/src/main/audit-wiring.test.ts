import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 执行审计的**接线锁**（M4 收尾 · 其二）。
 *
 * 单测已经证明每一段单独work；这里只回答一个问题：**这条链是不是真的从头接到尾**。
 * 审计最怕的失败形态不是"记错了"，而是"某一道门没接上" —— 那本账看起来完全正常，
 * 只是缺了最该在的那几行。所以链条上每一环都单独钉：
 *
 *   执行器出口 / 三扇非工具门 → 主进程服务 → 两条通道 → preload → 界面卡片
 *
 * 判据一律**现扫源码**（不写死清单），钉的是"每一环都在"，不是"某一行长这样"。
 *
 * R8.6 加的一环：git、打开外部程序、钩子配置这三扇门**不走 `runTool`**，
 * 它们的出口是 `audit-gate.ts` 的 `auditedGateRun` —— 同样只许有一处调用 `recordGate`，
 * 否则"哪个门接了、哪个门没接"又变成要靠记性数的事。
 */

// 用 import.meta.url 而不是 __dirname：这个包是 ESM，__dirname 不存在（仓库里其他接线锁同一写法）
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** 去掉注释与字符串里的假命中：接线锁读的是代码，不是散文 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const EXECUTOR = stripComments(read('../../../../packages/agent-core/src/tools/executor.ts'));
const CHAT = stripComments(read('./ipc/turn-trigger.ts'));
const TOOLS = stripComments(read('./ipc/tools.ts'));
const CANVAS = stripComments(read('./ipc/canvas.ts'));
const IPC = stripComments(read('./ipc.ts'));
const PRELOAD = stripComments(read('../preload/index.ts'));
const PANEL = stripComments(read('../renderer/src/features/permissions/PermissionRulesPanel.tsx'));
const SERVICE = stripComments(read('./audit-service.ts'));
const GATE_RUN = stripComments(read('./audit-gate.ts'));
const GIT_SVC = stripComments(read('./git-service.ts'));
const OWS_SVC = stripComments(read('./open-with-service.ts'));
const EXT_IPC = stripComments(read('./ipc/extensions.ts'));

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

  it('界面上有"执行审计"这一卡，范围声明说的是今天的事实', () => {
    expect(PANEL).toContain('执行审计');
    expect(PANEL).toContain('auditTail');
    expect(PANEL).toContain('auditExport');
    // 接线不留尾巴：三扇门已经进账，上一轮那句「尚未接入」必须跟着消失
    expect(PANEL).not.toContain('尚未接入');
    // 但"范围声明"本身不许一起删 —— 内置终端确实不在账里，界面必须说出来
    // （否则就是反过来犯同一个错：把一本缺页的账宣称成全账）
    expect(PANEL).toContain('内置终端');
  });

  it('三扇非工具门都走同一个出口，且都在做事之前把判定标出来', () => {
    const sites: ReadonlyArray<readonly [string, string, string]> = [
      ['git', GIT_SVC, 'execute(root)'],
      ['打开方式', OWS_SVC, 'handOver('],
      ['钩子配置', EXT_IPC, 'hooks.save('],
    ];
    for (const [name, src, actionAt] of sites) {
      expect(src, name).toContain('auditedGateRun(');
      const marked = src.indexOf('mark({ gate');
      expect(marked, `${name} 没有把判定标进审计`).toBeGreaterThan(-1);
      // 标判定必须发生在真正做事之前 —— 反过来写，"做完才标"会让中途抛错的那次永远没账
      expect(marked, `${name} 的判定标在了做事之后`).toBeLessThan(src.indexOf(actionAt));
    }
    // 问过人与没问过人是两格：只有真的弹过窗才许标 asked
    for (const src of [GIT_SVC, OWS_SVC, EXT_IPC]) {
      expect(src).toContain('mark({ asked: true, answer: decision })');
    }
  });

  it('非工具门的记账也只有一个出口（服务不许被三个门各调一次、各拼一份）', () => {
    expect((GATE_RUN.match(/\.recordGate\(/g) ?? []).length).toBe(1);
    expect(GATE_RUN).toContain('} finally {');
    for (const src of [GIT_SVC, OWS_SVC, EXT_IPC, CHAT, TOOLS, CANVAS]) {
      expect(src).not.toContain('.recordGate(');
      // 三样"事实的形状"都不许在入口侧自己拼：剔密与行格式只在服务里
      expect(src).not.toContain('makeRecord(');
    }
  });

  it('非工具门不许自己推导结论：判定原样标出，executed 由返回值推出', () => {
    // 出口只认 gate.action，不在这一层重算"该算什么结论"（同一件事两处各说各话的老病）
    expect(GATE_RUN).toContain('outcome: gate.action');
    expect(GATE_RUN).toContain('executed: result?.ok === true');
    // 参数也是原样递过去，摘要在服务里做
    expect(GATE_RUN).not.toContain('summarizeArgs(');
  });
});
