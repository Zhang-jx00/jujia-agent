import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T23 的接线锁：终端会话的生命周期（pty 常驻但可手工关闭）。
 *
 * 为什么又是源码锁（同 `tab-state-wiring` / `docs-wiring` 的理由）：这条修复的正确性
 * **不在任何单个文件里**。纯规则（`decideStart` / `trimTail`）有自己的单测，
 * 但"卸载时不许杀会话""回来必须先问再接""审批必须排在上限判定之后"这三件事
 * 是跨四个文件的**顺序与形状** —— 改错一行，全量单测照样绿，而用户看到的还是
 * "切个页签终端就没了"或者"一个工作区两个 PTY"。
 *
 * 覆盖边界（别往大里理解）：这里只钉接线形态；"切走再回来会话真的还活着"
 * 由 e2e 新增的那一步用真 PTY + 真进程断言。
 */

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const readMain = (rel: string): string => stripComments(readFileSync(join(here, rel), 'utf8'));
const readRenderer = (rel: string): string =>
  stripComments(readFileSync(join(here, '..', 'renderer', 'src', rel), 'utf8'));

const panel = readRenderer('features/terminal/TerminalPanel.tsx');
const service = readMain('./terminal-service.ts');
const ipcTerminal = readMain('./ipc/terminal.ts');
const preload = readMain('../preload/index.ts');
const channels = readMain('../../../../packages/shared-ipc/src/channels.ts');

describe('T23-①：卸载只销毁视图，不结束会话', () => {
  it('整个面板里 terminalKill 只许出现一次，而且在那次「结束会话」的点击里', () => {
    const occurrences = panel.match(/terminalKill\(/g) ?? [];
    expect(occurrences.length).toBe(1);
    const killIndex = panel.indexOf('terminalKill(');
    // 杀掉它的那段必须是按钮的 onClick（不是任何 clean-up 返回值）
    expect(panel.slice(Math.max(0, killIndex - 400), killIndex)).toContain('onClick');
  });

  it('销毁 xterm 的那个 clean-up 里**不许**带 kill（这是被修掉的原样）', () => {
    const idx = panel.indexOf('.dispose()');
    expect(idx).toBeGreaterThan(-1);
    const cleanup = panel.slice(panel.lastIndexOf('useEffect(', idx), idx + 400);
    expect(cleanup).not.toContain('terminalKill');
  });

  it('界面上不许再出现"离开此页自动结束"这类承诺', () => {
    expect(panel).not.toMatch(/自动结束/);
    expect(panel).toContain('切走页签不会结束会话');
    // 手工关闭这条要说清楚（用户得知道会话到底怎么才能结束）
    expect(panel).toContain('结束会话');
  });
});

describe('T23-②：回来先问再接，不直接起进程', () => {
  it('面板挂载时查 terminalStatus，并且接回（attach）的是快照里的会话', () => {
    expect(panel).toContain('window.jujia.terminalStatus(');
    expect(panel).toContain('sessionRef.current = snapshot.sessionId');
  });

  it('接回的块**不显示成"新起的"**：adopted 与"已接回"两条都在界面上', () => {
    expect(panel).toContain('result.adopted');
    expect(panel).toContain('已接回');
  });

  it('主进程的顺序：接回/上限判定在前，权限门在后（先审批再拒绝就是骗用户点一次确认）', () => {
    const decide = service.indexOf('decideStart(');
    const ask = service.indexOf('this.permission(');
    expect(decide).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(ask);
    // 三条分支都得处理，缺一条就是"决策算了但没人用"
    expect(service).toContain("decision.kind === 'adopt'");
    expect(service).toContain("decision.kind === 'refuse'");
  });

  it('接回时不许再 spawn：`pty.spawn` 只出现在权限门之后', () => {
    expect(service.indexOf('pty.spawn')).toBeGreaterThan(service.indexOf('this.permission('));
  });
});

describe('T23-③：切走期间的输出有界、可补回、不重不漏', () => {
  it('输出既进 tail 也进 seq —— 只推 IPC 不记账，回来就是空白视图', () => {
    expect(service).toContain('session.tail = trimTail(session.tail, data)');
    expect(service).toContain('session.seq += 1');
    expect(service).toContain('seq: session.seq');
  });

  it('渲染层按序号过滤：快照里已经含的块不再写第二遍', () => {
    expect(panel).toContain('event.seq <= seqFloorRef.current');
    // 快照还没到时先攒着，否则间隙里的块既不在 tail 也没人收（少一段）
    expect(panel).toContain('pendingRef.current.push');
  });

  it('订阅排在快照之前（顺序反了就会漏掉间隙里的输出）', () => {
    expect(panel.indexOf('onTerminalStream')).toBeLessThan(panel.indexOf('terminalStatus('));
  });

  it('会话在看不见的时候退出了，回来必须有话说（exitNotice 从主进程带到界面）', () => {
    expect(service).toContain('this.rememberExit(');
    expect(service).toContain('describeExitNotice(');
    expect(panel).toContain('result.exited.notice');
  });
});

describe('T23-⑤：权限语义一个都没被放宽（本轮改的是"什么时候要问"，不是"要不要问"）', () => {
  it('终端仍然是 exec 类、仍然硬 ask：kind 与 bypassable 两条都钉住', () => {
    expect(service).toContain("kind: 'exec'");
    expect(service).toContain("bypassable: false");
    expect((service.match(/bypassable: false/g) ?? []).length).toBe(1);
    expect(service).not.toContain('bypassable: true');
    expect(service).toContain("toolName: 'terminal'");
  });

  it('全文件只有一个审批入口，而且只在真的新起进程那条路上', () => {
    expect((service.match(/this\.permission\(/g) ?? []).length).toBe(1);
    expect(service.indexOf('this.permission(')).toBeGreaterThan(service.indexOf("decision.kind === 'refuse'"));
  });

  it('fail-closed 不动：取不到审批就是拒绝，不许"默认放行"', () => {
    expect(ipcTerminal).toContain("Promise.resolve('deny' as const)");
  });
});

describe('T23-④：新通道要真的接上线', () => {
  it('channels.ts → ipc 注册 → preload 暴露，三处都在（缺一个就是"文档说能做、运行期不可达"）', () => {
    expect(channels).toContain("TERMINAL_STATUS: 'terminal:status'");
    expect(ipcTerminal).toContain('handle(IPC.TERMINAL_STATUS');
    expect(preload).toContain('terminalStatus(');
  });

  it('状态查询也要过工作区核对：把别的工作区的会话递给当前面板，接回去的就是个 cwd 不对的终端', () => {
    expect(ipcTerminal).toContain('parsed.data.workspaceRoot !== ws.root');
    expect(ipcTerminal).toContain('terminal.status(ws.root)');
  });

  it('应用退出仍然回收全部会话（常驻不等于泄漏，这条从 T23 起更是唯一的上界保证）', () => {
    const raw = readFileSync(join(here, 'ipc', 'terminal.ts'), 'utf8');
    expect(raw).toContain('terminal.disposeAll();');
  });
});
