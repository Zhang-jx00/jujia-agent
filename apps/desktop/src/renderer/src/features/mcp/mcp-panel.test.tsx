// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { McpApprovalPlan } from '@jujia/shared-ipc';
import { McpPanel } from './McpPanel';

/**
 * MCP 批准界面的**文案断言**（T53 · R47）。
 *
 * 为什么这个页面值得单独测：它是"一个第三方进程要被接进这台电脑"这件事的**唯一**确认点。
 * 而 T53 这一档有一处特别容易骗人的地方 ——
 * **「只读」不是本机判出来的**，是服务端自己声明的（`annotations.readOnlyHint`）。
 * 标签上写一个「只读」，读起来就像一道本机守卫 ⇒ 用户以为本机还管得住它。
 *
 * R47 的处置：**信任边界不移动**（自述只当提示，判定仍以本机敏感路径表为准），
 * 代价是**必须把"这是服务端声明"与"本机那张表只认哪个键"说出口**。
 * 判据落在**渲染出来的文本**上（这句话的作用是让正在批准的人看见，藏在注释里等于没说）。
 */

function plan(over: Partial<McpApprovalPlan> = {}): McpApprovalPlan {
  return {
    serverId: 's1',
    serverName: '自称只读的服务端',
    commandLine: 'npx -y some-mcp-server',
    envKeys: [],
    toolCount: 2,
    alwaysAskCount: 1,
    readOnlyCount: 1,
    tools: [
      {
        qualifiedName: 's1__read_note',
        rawName: 'read_note',
        kind: 'read',
        kindReason: '服务端明确声明只读',
        description: '读一条笔记',
      },
      {
        qualifiedName: 's1__write_note',
        rawName: 'write_note',
        kind: 'exec',
        kindReason: '服务端未提供注解 → 默认按最严格处理',
        description: '写一条笔记',
      },
    ],
    warnings: [],
    needsExtraAttention: true,
    ...over,
  };
}

const serverList = vi.fn();
const pendingPlan = vi.fn();

function mount(p: McpApprovalPlan | null): void {
  serverList.mockResolvedValue([]);
  pendingPlan.mockResolvedValue(p);
  render(<McpPanel />);
}

beforeEach(() => {
  serverList.mockReset();
  pendingPlan.mockReset();
  vi.stubGlobal('jujia', {
    mcpServerList: serverList,
    mcpPendingPlan: pendingPlan,
    onMcpStateChanged: vi.fn().mockReturnValue(() => undefined),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MCP 批准界面 · 「只读」这一档是谁说的（T53 · R47）', () => {
  it('工具那一栏的标签写明"服务端声明"，不许写成一个像本机判定的「只读」', async () => {
    mount(plan());
    await screen.findByText('read_note');
    const body = document.body.textContent ?? '';

    expect(body).toContain('服务端声明只读');
    // 旧标签（只有「只读」两个字）必须绝迹：它读起来像一道本机守卫
    expect(body).not.toContain('[只读]');
    // 反向对照：`exec` 那一档是**本机**的默认（不声明就按最严格处理），标签照实
    expect(body).toContain('[每次询问]');
  });

  it('说清边界：这一档是服务端声明的、不再问你、本机那张表只认叫 path 的键', async () => {
    mount(plan());
    await screen.findByText('read_note');
    const body = document.body.textContent ?? '';

    expect(body).toContain('服务端自己声明');
    expect(body).toContain('不再问你');
    expect(body).toContain('敏感路径表');
    expect(body).toContain('path');
    // 边界要落在"本机不替它担保"这句话上
    expect(body).toContain('不替它担保');
  });

  it('反向对照：一个只读工具都没有时，不许冒这句边界提示（噪声等于没说）', async () => {
    const p = plan({
      readOnlyCount: 0,
      alwaysAskCount: 2,
      toolCount: 2,
      tools: [
        {
          qualifiedName: 's1__write_note',
          rawName: 'write_note',
          kind: 'exec',
          kindReason: '服务端未提供注解 → 默认按最严格处理',
          description: '写一条笔记',
        },
      ],
    });
    mount(p);
    await screen.findByText('write_note');
    const body = document.body.textContent ?? '';

    expect(body).not.toContain('不替它担保');
    expect(body).not.toContain('服务端声明只读');
  });
});
