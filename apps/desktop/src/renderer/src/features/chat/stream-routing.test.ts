import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { belongsToSession } from './stream-routing';

/**
 * 流事件的分发闸口（外部审查 T5）。
 *
 * 真实形状是这样的：主进程把 `CHAT_STREAM` **全局广播**，而面板只订阅一次。
 * 增量事件（text_delta）因为要按 messageId 找气泡，切了会话之后看起来"没事"；
 * 但 `done` / `error` / `usage` / `tool_start` / `tool_end` 不需要 messageId，
 * 它们会直接落到当前界面上 —— 于是"上一个会话还没说完"就会把新会话的界面改错：
 * 新会话的输入框被点亮、token 数变成别人的、正在转的工具行被别的会话结束掉。
 */
describe('belongsToSession', () => {
  it('事件属于当前会话 → 放行', () => {
    expect(belongsToSession({ sessionId: 'A' }, 'A')).toBe(true);
  });

  it('事件属于别的会话 → 丢弃（这就是那条污染路径）', () => {
    expect(belongsToSession({ sessionId: 'A' }, 'B')).toBe(false);
  });

  it('还没选定任何会话 → 一律丢弃（空界面上不该画出别人的收尾）', () => {
    expect(belongsToSession({ sessionId: 'A' }, undefined)).toBe(false);
    expect(belongsToSession({ sessionId: 'A' }, '')).toBe(false);
  });

  it('六类事件都带 sessionId（少了这个字段，上面三条都无从谈起）', () => {
    // 契约在 shared-ipc 里；这里钉的是"契约确实给了这个字段"这一事实
    const here = dirname(fileURLToPath(import.meta.url));
    // 本文件在 apps/desktop/src/renderer/src/features/chat/ —— 到仓库根要上 7 层
    const contracts = readFileSync(
      join(here, '..', '..', '..', '..', '..', '..', '..', 'packages', 'shared-ipc', 'src', 'contracts.ts'),
      'utf8',
    );
    const block = contracts.slice(
      contracts.indexOf('export const streamEventSchema'),
      contracts.indexOf('export type StreamEvent'),
    );
    expect((block.match(/sessionId: z.string\(\)/g) ?? []).length).toBe(6);
  });
});

describe('闸口真的挂在订阅回调的第一行（接线锁）', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const panel = strip(readFileSync(join(here, 'ChatPanel.tsx'), 'utf8'));

  it('onStream 回调一进来就筛会话，任何一类事件都没有旁路', () => {
    const at = panel.indexOf("window.jujia.onStream((event: StreamEvent) => {");
    expect(at).toBeGreaterThan(-1);
    const head = panel.slice(at, at + 460);
    const body = head.slice(head.indexOf('=> {') + 4).trimStart();
    // 回调体里的**第一条语句**就是闸门：写成"先处理某类事件再筛"就会留下旁路
    expect(body.startsWith('if (!belongsToSession(event, sessionIdRef.current)) return;')).toBe(true);
  });

  it('筛完用的是 ref 而不是 state（订阅只建一次，闭包里的 state 会永远停在第一帧）', () => {
    expect(panel).toContain('belongsToSession(event, sessionIdRef.current)');
    expect(panel).not.toContain('belongsToSession(event, sessionId)');
  });

  it('改 sessionId 只能经 selectSession，ref 与状态一起走', () => {
    expect(panel).toContain('sessionIdRef.current = id;');
    const direct = panel.match(/setSessionId\(/g) ?? [];
    // 只允许出现在 selectSession 那一处
    expect(direct.length).toBe(1);
  });

  /**
   * 筛了事件之后，"上一个会话的 done 会顺手把 sending 归零"这件事就没有了 ——
   * 换会话时必须自己清场，否则界面永远卡在"停止"按钮上（这是本次修复引入的新约束，钉住它）。
   */
  it('换会话的两条路径都先清场（resetView），不留上一格的 sending / usage', () => {
    expect(panel).toContain('setSending(false);');
    const resumeAt = panel.indexOf('async function resume(');
    const newAt = panel.indexOf('              resetView();');
    expect(resumeAt).toBeGreaterThan(-1);
    expect(newAt).toBeGreaterThan(resumeAt);
    expect(panel.slice(resumeAt, resumeAt + 320)).toContain('resetView();');
  });
});
