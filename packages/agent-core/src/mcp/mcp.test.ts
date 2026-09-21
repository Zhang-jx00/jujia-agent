import { describe, expect, it } from 'vitest';
import {
  buildInitialize,
  buildRequest,
  buildServerCommand,
  buildToolsCall,
  buildToolsList,
  inferToolKind,
  MCP_PROTOCOL_VERSION,
  parseMessage,
  parseToolList,
  toToolProfiles,
  validateServerConfig,
  type McpServerConfig,
} from './mcp';

/**
 * W10a 验收重点：
 * 1. **Windows 命令适配**：`npx` 在 Windows 上是 `.cmd`，必须走 `cmd /c`（否则 spawn ENOENT）；
 * 2. **注入防护**：args 以数组传递，且 shell 元字符一律拒绝；
 * 3. **权限分级为安全关键**：MCP 工具来自第三方 → **默认 `exec`（每次都问）**，
 *    只有服务端**明确声明只读**才降为 `read`；注解缺失/矛盾/破坏性一律 `exec`；
 * 4. 脏数据不能让整份工具列表失效。
 */

const cfg = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'fs',
  name: '文件系统服务',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\ws'],
  ...over,
});

describe('buildServerCommand：跨平台适配', () => {
  it('Windows 上 npx 走 cmd /c（否则 spawn 会 ENOENT）', () => {
    const c = buildServerCommand(cfg(), 'win32');
    expect(c.file).toBe('cmd.exe');
    expect(c.args.slice(0, 3)).toEqual(['/c', 'npx', '-y']);
  });

  it('Windows 上 .cmd / .bat 也走 cmd /c', () => {
    expect(buildServerCommand(cfg({ command: 'foo.cmd' }), 'win32').file).toBe('cmd.exe');
    expect(buildServerCommand(cfg({ command: 'bar.BAT' }), 'win32').file).toBe('cmd.exe');
  });

  it('Windows 上普通 exe 不需要 cmd 包装', () => {
    const c = buildServerCommand(cfg({ command: 'D:\\tools\\server.exe', args: [] }), 'win32');
    expect(c.file).toBe('D:\\tools\\server.exe');
    expect(c.args).toEqual([]);
  });

  it('非 Windows 原样返回', () => {
    const c = buildServerCommand(cfg(), 'linux');
    expect(c.file).toBe('npx');
    expect(c.args[0]).toBe('-y');
  });

  it('参数始终以数组传递（不做 shell 拼接）', () => {
    const c = buildServerCommand(cfg({ args: ['a b', 'c"d'] }), 'linux');
    expect(c.args).toEqual(['a b', 'c"d']);
  });
});

describe('validateServerConfig：注入防护与字段校验', () => {
  it('合法配置通过', () => {
    expect(validateServerConfig(cfg()).ok).toBe(true);
  });

  it('缺字段被拒', () => {
    expect(validateServerConfig({ id: 'x' }).ok).toBe(false);
    expect(validateServerConfig(null).ok).toBe(false);
  });

  it.each(['npx | cat', 'npx; rm -rf /', 'npx && echo', 'npx `whoami`', 'npx $(id)', 'npx\nwhoami'])(
    'command 含 shell 元字符被拒：%s',
    (cmd) => {
      const r = validateServerConfig(cfg({ command: cmd }));
      expect(r.ok).toBe(false);
      expect(r.errors.join()).toContain('shell 元字符');
    },
  );

  it('args 里的 shell 元字符同样被拒（防止经 cmd /c 被解释执行）', () => {
    const r = validateServerConfig(cfg({ args: ['-y', 'pkg && whoami'] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('shell 元字符');
  });

  it('args 非字符串数组被拒', () => {
    expect(validateServerConfig({ ...cfg(), args: [1, 2] }).ok).toBe(false);
    expect(validateServerConfig({ ...cfg(), args: 'npx' }).ok).toBe(false);
  });

  it('env 必须是对象', () => {
    expect(validateServerConfig({ ...cfg(), env: [] }).ok).toBe(false);
    expect(validateServerConfig({ ...cfg(), env: { A: 'b' } }).ok).toBe(true);
  });
});

describe('JSON-RPC 报文', () => {
  it('initialize 声明协议版本与客户端信息', () => {
    const req = buildInitialize(1);
    expect(req.method).toBe('initialize');
    expect((req.params as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect((req.params as { clientInfo: { name: string } }).clientInfo.name).toBe('jujia-agent');
  });

  it('tools/list 与 tools/call 形状正确', () => {
    expect(buildToolsList(2)).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(buildToolsCall(3, 'read_file', { path: 'a' })).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'a' } },
    });
  });

  it('不带 params 时不产生 params 字段', () => {
    expect(buildRequest(1, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
  });

  it('解析成功响应', () => {
    const r = parseMessage('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}');
    expect(r.type).toBe('response');
    if (r.type === 'response' && 'result' in r.value) expect(r.value.id).toBe(7);
  });

  it('解析错误响应（补齐缺失字段）', () => {
    const r = parseMessage('{"jsonrpc":"2.0","id":8,"error":{"code":-32601}}');
    expect(r.type).toBe('response');
    if (r.type === 'response' && 'error' in r.value) {
      expect(r.value.error.code).toBe(-32601);
      expect(r.value.error.message).toBe('未知错误');
    }
  });

  it.each([
    ['', '空行'],
    ['not json', '不是合法 JSON'],
    ['[1,2,3]', '不是对象'],
    ['{"id":1,"result":{}}', '缺少 jsonrpc'],
    ['{"jsonrpc":"2.0","result":{}}', '既无数字 id 也无 method'],
    ['{"jsonrpc":"2.0","id":1,"method":"notifications/x"}', '服务端发来的请求'],
  ])('非法报文返回 invalid 而不是抛异常：%s', (line, reason) => {
    const r = parseMessage(line);
    expect(r.type).toBe('invalid');
    if (r.type === 'invalid') expect(r.reason).toContain(reason);
  });

  it('外部进程混入日志行不会抛异常', () => {
    expect(() => parseMessage('Server started on port 3000')).not.toThrow();
  });
});

describe('parseToolList：脏数据防御', () => {
  it('正常解析', () => {
    const out = parseToolList({
      tools: [{ name: 'read_file', description: '读文件', inputSchema: { type: 'object' } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('read_file');
  });

  it('非法项被跳过，不影响其余项', () => {
    const out = parseToolList({
      tools: [null, 42, { name: '' }, { nope: 1 }, { name: 'good' }],
    });
    expect(out.map((t) => t.name)).toEqual(['good']);
  });

  it('结果不是数组时返回空列表', () => {
    expect(parseToolList({ tools: 'oops' })).toEqual([]);
    expect(parseToolList(null)).toEqual([]);
    expect(parseToolList({})).toEqual([]);
  });

  it('只保留布尔型注解（类型不对的丢弃）', () => {
    const out = parseToolList({
      tools: [{ name: 'x', annotations: { readOnlyHint: 'yes', destructiveHint: true } }],
    });
    expect(out[0]?.annotations).toEqual({ destructiveHint: true });
  });
});

describe('inferToolKind：权限分级（安全关键）', () => {
  it('**无注解 → 默认 exec**（第三方工具能力未知，一律每次都问）', () => {
    const r = inferToolKind({ name: 'anything' });
    expect(r.kind).toBe('exec');
    expect(r.reason).toContain('默认按最严格');
  });

  it('注解存在但未声明只读 → 仍是 exec', () => {
    expect(inferToolKind({ name: 'x', annotations: { idempotentHint: true } }).kind).toBe('exec');
  });

  it('明确声明只读 → 降为 read', () => {
    const r = inferToolKind({ name: 'x', annotations: { readOnlyHint: true } });
    expect(r.kind).toBe('read');
    expect(r.reason).toContain('明确声明只读');
  });

  it('声明破坏性 → 保持 exec，并标明理由', () => {
    const r = inferToolKind({ name: 'x', annotations: { destructiveHint: true } });
    expect(r.kind).toBe('exec');
    expect(r.reason).toContain('破坏性');
  });

  it('**注解自相矛盾（只读 + 破坏性）→ 取更严格的一侧**', () => {
    const r = inferToolKind({ name: 'x', annotations: { readOnlyHint: true, destructiveHint: true } });
    expect(r.kind).toBe('exec');
    expect(r.reason).toContain('矛盾');
  });

  it('只读 + 其他非破坏性注解 → read', () => {
    const r = inferToolKind({
      name: 'x',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    });
    expect(r.kind).toBe('read');
  });
});

describe('toToolProfiles：加前缀与分级理由', () => {
  it('加服务端前缀，避免不同服务端同名工具互相覆盖', () => {
    const p = toToolProfiles('fs', [{ name: 'read_file' }]);
    expect(p[0]?.qualifiedName).toBe('fs__read_file');
    expect(p[0]?.rawName).toBe('read_file');
    expect(p[0]?.serverId).toBe('fs');
  });

  it('不同服务端的同名工具不冲突', () => {
    const a = toToolProfiles('fs', [{ name: 'read' }])[0]?.qualifiedName;
    const b = toToolProfiles('git', [{ name: 'read' }])[0]?.qualifiedName;
    expect(a).not.toBe(b);
  });

  it('无描述时给占位说明（不留下空字段）', () => {
    expect(toToolProfiles('fs', [{ name: 'x' }])[0]?.description).toContain('无描述');
  });

  it('无 inputSchema 时给合法空 schema', () => {
    expect(toToolProfiles('fs', [{ name: 'x' }])[0]?.inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('每项都带 kindReason，便于 UI 解释"为什么每次都要问"', () => {
    const p = toToolProfiles('fs', [{ name: 'a' }, { name: 'b', annotations: { readOnlyHint: true } }]);
    expect(p[0]?.kindReason).toBeTruthy();
    expect(p[1]?.kindReason).toBeTruthy();
    expect(p[0]?.kind).toBe('exec');
    expect(p[1]?.kind).toBe('read');
  });
});
