// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { McpApprovalPlan, McpServerView } from '@jujia/shared-ipc';
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
const serverSave = vi.fn();

function mount(p: McpApprovalPlan | null): void {
  serverList.mockResolvedValue([]);
  pendingPlan.mockResolvedValue(p);
  render(<McpPanel />);
}

beforeEach(() => {
  serverList.mockReset();
  pendingPlan.mockReset();
  serverSave.mockReset();
  vi.stubGlobal('jujia', {
    mcpServerList: serverList,
    mcpPendingPlan: pendingPlan,
    mcpServerSave: serverSave,
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

/**
 * 「掉线后自动重连」那一格（T31 · 选项 B · R52）。
 *
 * 为什么这个页面值得单独测这三件事：
 * ① **默认不勾** —— 自动重连 = 在没人点过的情况下再起一个第三方进程，
 *    所以它必须是**逐个服务端显式授权**的（白名单）。默认勾上 = 默认授权。
 * ② **说明在** —— 勾上它的人必须知道两件事：它会被授权在掉线后自动重启，
 *    以及**重连仍要重新批准**（自动重连只免掉"再点一次连接"）。
 * ③ **重连的次数与原因看得见** —— 否则失败是静默的，用户只看到"失败"两个字。
 */
describe('MCP 界面 · 「掉线后自动重连」（T31 · 选项 B · R52）', () => {
  function serverView(over: Partial<McpServerView> = {}): McpServerView {
    return {
      id: 's1',
      name: '文件系统',
      command: 'npx',
      args: ['-y', 'demo-mcp'],
      envKeys: [],
      state: 'idle',
      discoveredTools: 0,
      enabledTools: [],
      lastError: null,
      autoReconnect: false,
      source: 'user',
      pluginName: null,
      disabledByPlugin: false,
      ...over,
    };
  }

  function mountServer(v: McpServerView): void {
    serverList.mockResolvedValue([v]);
    pendingPlan.mockResolvedValue(null);
    serverSave.mockResolvedValue(v);
    render(<McpPanel />);
  }

  it('勾选框**默认不勾**（默认授权 = 默认替用户做决定）', async () => {
    mountServer(serverView());
    const box = (await screen.findByRole('checkbox', { name: /掉线后自动重连/ })) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('说明在：说清上限，也说清"**重连仍要重新批准**"', async () => {
    mountServer(serverView());
    await screen.findByRole('checkbox', { name: /掉线后自动重连/ });
    const body = document.body.textContent ?? '';

    expect(body).toContain('掉线后自动重连');
    expect(body).toContain('自己重连');
    // 免不掉的那一半必须写在界面上
    expect(body).toContain('再批一次工具');
    expect(body).toContain('待你批准');
    // 上限与退避也要说（用户有权知道它不会无限重试）
    expect(body).toContain('最多试 3 次');
  });

  it('**已授权时**说清"这个服务端被授权在掉线后自动重启"（否则用户不知道它会自己起来）', async () => {
    mountServer(serverView({ autoReconnect: true }));
    const box = (await screen.findByRole('checkbox', { name: /掉线后自动重连/ })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    const body = document.body.textContent ?? '';

    expect(body).toContain('已授权');
    expect(body).toContain('自动重新启动');
  });

  it('重连的**次数与最后一次失败原因**看得见（复用 lastError 那一格）', async () => {
    mountServer(
      serverView({
        state: 'error',
        lastError: '自动重连：已试 3 次都没成功，已放弃（最后一次：初始化被拒绝）',
      }),
    );
    await screen.findByRole('checkbox', { name: /掉线后自动重连/ });
    const body = document.body.textContent ?? '';

    expect(body).toContain('已试 3 次');
    expect(body).toContain('初始化被拒绝');
  });

  it('勾一下会带着 autoReconnect=true 去保存（走同一条保存通道）', async () => {
    mountServer(serverView());
    const box = (await screen.findByRole('checkbox', { name: /掉线后自动重连/ })) as HTMLInputElement;
    fireEvent.click(box);

    await vi.waitFor(() => expect(serverSave).toHaveBeenCalled());
    const payload = serverSave.mock.calls[0]?.[0] as { id: string; autoReconnect: boolean };
    expect(payload.id).toBe('s1');
    expect(payload.autoReconnect).toBe(true);
  });
});
