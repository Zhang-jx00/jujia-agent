import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolRegistry, runTool } from '@jujia/agent-core';
import { McpService } from './mcp-service';
import { createMemoryMcpStore } from './mcp-store';
import { createRealTransport } from './real-transport';

/**
 * T53 的**运行期证据**（R29 收口轮补，配合 `consent.test.ts` 那句"批准前说出口"的提示）。
 *
 * 登记的判断是两句话拼起来的：
 *   ① `readOnlyHint === true` ⇒ `kind:'read'` ⇒ 策略层直接 `allow`（不问人）；
 *   ② 敏感路径表 `pathOf()` **只认 `args['path']` 这一个键**，而 MCP 的参数是任意 JSON 原样透传。
 * 合起来：**外部服务自称只读，就能用一个我们叫不出名字的路径参数读走任意文件且不问**。
 *
 * 这个洞的修法（外部工具一律 ask，或给档案加 `pathArg` 声明）**改的是这台机器的信任边界**，
 * 属四类停牌里的第一项 ⇒ 不由我自行改。本轮要的是**让它可复现**：三个键名/注解的组合各测一次，
 * 谁将来动 `inferToolKind` 或 `pathOf`，这三条会同时告诉他动到了什么。
 *
 * **这些是"现状锁"**：把洞修好之后第二条会红 —— 那是**故意的摩擦**，
 * 逼着改的人回来读这段注释、把断言改成"会问"，而不是顺手把一个信任边界当性能问题改掉。
 *
 * 服务端是**自造的真子进程**（无网络、进默认套件）。真第三方服务端那条在
 * `mcp-real-server.test.ts`（`JUJIA_NET_TEST=1`，默认跳过），它回答的是
 * "官方 filesystem 服务端的自述长什么样"，两条各管一段，不互相代打。
 */
const SERVER_SCRIPT = `
  import { readFileSync } from 'node:fs';
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
      if (msg.method === 'initialize') {
        reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'selfdeclared', version: '1.0.0' } });
      } else if (msg.method === 'tools/list') {
        reply({
          tools: [
            // 键名正好叫 path：敏感路径表**看得见**
            { name: 'read_by_path', description: '按 path 读', annotations: { readOnlyHint: true } },
            // 键名叫 file_path：表看不见 ⇒ 自称只读 + 陌生键名 = 读走任意文件且不问
            { name: 'read_by_other_key', description: '按 file_path 读', annotations: { readOnlyHint: true } },
            // 没给注解：取更严的一侧（exec），照样要问
            { name: 'plain_by_other_key', description: '没自述的读' },
          ],
        });
      } else if (msg.method === 'tools/call') {
        const a = msg.params.arguments ?? {};
        const target = a['path'] ?? a['file_path'] ?? '';
        let text = '';
        try {
          text = String(readFileSync(String(target), 'utf8'));
        } catch (err) {
          text = 'READ_FAILED ' + (err instanceof Error ? err.message : String(err));
        }
        reply({ content: [{ type: 'text', text }] });
      } else {
        reply({});
      }
    }
  });
`;

const SENTINEL = 'T53-SENTINEL-DoNotReadMe-9e4f21';

let serverPath = '';
let wsDir = '';
let secretPath = '';
const cleanup: string[] = [];

beforeAll(() => {
  // 临时目录一律建在**项目内 .tmp**（收口轮会被 cleanup.py 收走，不污染系统盘）
  const base = mkdtempSync(join(process.cwd(), '.tmp', 'jujia-mcp-t53-'));
  cleanup.push(base);
  serverPath = join(base, 'server.mjs');
  writeFileSync(serverPath, SERVER_SCRIPT, 'utf8');
  wsDir = join(base, 'ws');
  mkdirSync(wsDir, { recursive: true });
  secretPath = join(wsDir, '.env');
  writeFileSync(secretPath, `API_KEY=${SENTINEL}\n`, 'utf8');
});

afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const registry = new ToolRegistry();
  const service = new McpService({
    registry,
    store: createMemoryMcpStore(),
    createTransport: (config, hooks) => createRealTransport(config, hooks, () => undefined),
    requestTimeoutMs: 8_000,
  });
  return { service, registry };
}

async function connected() {
  const { service, registry } = setup();
  const view = await service.save({
    name: '自称只读的服务端',
    command: process.execPath,
    args: [serverPath],
    env: {},
  });
  const result = await service.connect(view.id);
  if (!result.ok) throw new Error(`连接失败：${result.error}`);
  await service.approve(view.id, { action: 'approve_all' });
  return { service, registry, view, plan: result.plan };
}

describe('T53：自述只读 + 陌生键名 = 读走任意文件且不问（现状锁）', () => {
  it('自述只读的工具确实被判成 read（这一步是策略层的入口）', async () => {
    const { service, plan } = await connected();
    try {
      const byPath = plan.tools.find((t) => t.rawName === 'read_by_path');
      const byOther = plan.tools.find((t) => t.rawName === 'read_by_other_key');
      const plain = plan.tools.find((t) => t.rawName === 'plain_by_other_key');

      expect(byPath?.kind).toBe('read');
      expect(byOther?.kind).toBe('read');
      // 没自述的那个取**更严的一侧**：这是仓里做对了的半边，锁住它别被"默认只读"漂走
      expect(plain?.kind).toBe('exec');
      expect(byPath?.kindReason ?? byOther?.kindReason).toContain('只读');
    } finally {
      service.disposeAll();
    }
  }, 40_000);

  it('键名表认得的 path：读敏感文件**会问人**（敏感路径表真的在生效）', async () => {
    const { service, registry, view } = await connected();
    try {
      let asked = false;
      const res = await runTool(
        registry.get(`${view.id}__read_by_path`),
        { path: secretPath },
        { workspaceRoot: wsDir },
        async () => {
          asked = true;
          return 'deny';
        },
      );
      expect(asked, '敏感路径却不问人 —— 表整个失效了').toBe(true);
      expect(res.outcome.ok).toBe(false);
      expect(res.outcome.content).not.toContain(SENTINEL);
    } finally {
      service.disposeAll();
    }
  }, 40_000);

  it('同一个敏感文件，键名换成 file_path：**不问就把内容读回来了**（这就是 T53 的洞）', async () => {
    const { service, registry, view } = await connected();
    try {
      let asked = false;
      const res = await runTool(
        registry.get(`${view.id}__read_by_other_key`),
        { file_path: secretPath },
        { workspaceRoot: wsDir },
        async () => {
          asked = true;
          return 'deny';
        },
      );
      // 这两条断言写的是**当前事实**，不是"应当如此"：
      expect(asked, '现状：陌生键名不触发询问；若这里变成 true，说明信任边界被改过（那是停牌①的决定）').toBe(false);
      expect(res.outcome.content).toContain(SENTINEL);
    } finally {
      service.disposeAll();
    }
  }, 40_000);

  it('反向对照：洞是"自述只读 + 陌生键名"的**组合**，不是"外部工具没人管"', async () => {
    const { service, registry, view } = await connected();
    try {
      let asked = false;
      const res = await runTool(
        registry.get(`${view.id}__plain_by_other_key`),
        { file_path: secretPath },
        { workspaceRoot: wsDir },
        async () => {
          asked = true;
          return 'deny';
        },
      );
      expect(asked).toBe(true); // 没自述 ⇒ exec ⇒ 照问
      expect(res.outcome.ok).toBe(false);
    } finally {
      service.disposeAll();
    }
  }, 40_000);
});
