import { describe, expect, it } from 'vitest';
import { ToolRegistry, runTool } from '@jujia/agent-core';
import { McpService } from './mcp-service';
import { createMemoryMcpStore } from './mcp-store';
import { createRealTransport } from './real-transport';

/**
 * MCP **真实服务端**端到端验证（等价于"人工在界面里连接并让模型调用"那套手工流程）。
 *
 * 与 `mcp-e2e.test.ts` 的区别：那一个用的是**自造的假服务端脚本**（无网络依赖，进默认套件）；
 * 这一个连的是**真实第三方服务端**（经 npx 下载启动），因此：
 * - **依赖网络**（首次还要下载包，握手可能几十秒），所以用 `JUJIA_NET_TEST=1` 显式开启，
 *   **不进默认测试套件** —— 默认套件必须快且确定，不能被网络拖累；
 * - 存储用内存实现，**不碰 %APPDATA%**，可以随便反复跑。
 *
 * 覆盖到的链路：保存配置 → 起真子进程 → 握手 → 列工具 → **部分批准** →
 * 未批准的工具无调用路径 → 经真实权限门真调用取回目录内容 → 断开后摘工具。
 * 不覆盖：界面点击，以及"模型是否愿意调用"（那取决于模型本身）。
 *
 * 手动运行：
 *   JUJIA_NET_TEST=1 npx vitest run apps/desktop/src/main/mcp/mcp-real-server.test.ts
 */

const ENABLED = process.env['JUJIA_NET_TEST'] === '1';
const WORKSPACE = 'D:\\MiMo\\ProjectOne';
const SERVER = 'npx';
const SERVER_ARGS = ['-y', '@modelcontextprotocol/server-filesystem', WORKSPACE];

describe.skipIf(!ENABLED)('MCP 真实服务端（需 JUJIA_NET_TEST=1）', () => {
  it('连接 → 部分批准 → 只读工具真调用 → 断开摘工具', async () => {
    const debug: string[] = [];
    const registry = new ToolRegistry();
    const service = new McpService({
      registry,
      store: createMemoryMcpStore(),
      createTransport: (config, hooks) => createRealTransport(config, hooks, (m) => debug.push(m)),
      requestTimeoutMs: 30_000,
      // 真实首次运行可能要下载包（本机实测约 55s），握手给足时间
      initializeTimeoutMs: 120_000,
    });

    try {
      const view = await service.save({
        name: '真实文件系统服务端',
        command: SERVER,
        args: SERVER_ARGS,
        env: {},
      });

      const connected = await service.connect(view.id);
      expect(connected.ok, `连接失败：${connected.ok ? '' : connected.error}`).toBe(true);
      if (!connected.ok) return;

      expect(connected.plan.toolCount).toBeGreaterThan(0);
      const readOnly = connected.plan.tools.filter((t) => t.kind === 'read');
      const listTool = readOnly.find((t) => t.rawName === 'list_directory') ?? readOnly[0];
      expect(listTool, '这个服务端没有只读工具，无法继续').toBeTruthy();
      if (listTool === undefined) return;

      // 部分批准：只批只读的
      const approved = await service.approve(view.id, {
        action: 'approve_partial',
        toolNames: readOnly.map((t) => t.qualifiedName),
      });
      expect(approved.registered.length).toBe(readOnly.length);

      // 关键断言：未批准的写类工具**不在注册表里** —— 不是"注册了但拦着"，是根本没有调用路径
      for (const t of connected.plan.tools.filter((x) => x.kind !== 'read')) {
        expect(registry.has(t.qualifiedName), `未批准的工具竟然被注册了：${t.qualifiedName}`).toBe(false);
      }

      // 经真实权限门调用；只读工具不应触发权限询问
      let asked = false;
      const res = await runTool(
        registry.get(listTool.qualifiedName),
        { path: WORKSPACE },
        { workspaceRoot: WORKSPACE },
        async () => {
          asked = true;
          return 'deny';
        },
      );
      expect(asked).toBe(false);
      expect(res.outcome.ok, `工具调用失败：${res.outcome.content}`).toBe(true);
      // 真实服务端返回真实目录内容
      expect(res.outcome.content).toMatch(/俱佳agent|node_modules/);

      // 断开：工具被摘掉
      await service.disconnect(view.id);
      for (const name of approved.registered) {
        expect(registry.has(name), `断开后工具仍在注册表里：${name}`).toBe(false);
      }
      const after = (await service.views())[0];
      expect(after?.enabledTools ?? []).toHaveLength(0);
    } finally {
      service.disposeAll();
    }
  }, 180_000);
});
