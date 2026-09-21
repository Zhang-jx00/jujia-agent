import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_LINE_BYTES,
  KILL_GRACE_MS,
  createStdioTransport,
  type SpawnLike,
} from './stdio-transport';

/**
 * 假子进程：完全由测试驱动字节流，因此可以精确构造
 * "半行 / 多行 / 多字节被切断 / 崩溃 / 超长行" 这些真实但难复现的场景。
 */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new (class extends EventEmitter {
    writes: string[] = [];
    ended = false;
    write(chunk: string): boolean {
      this.writes.push(chunk);
      return true;
    }
    end(): void {
      this.ended = true;
    }
  })();
  kills: string[] = [];

  kill(signal?: string): boolean {
    this.kills.push(signal ?? 'SIGTERM');
    return true;
  }

  /** 模拟子进程退出 */
  die(code: number | null = 0, signal: string | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

function setup(options: Partial<Parameters<typeof createStdioTransport>[0]> = {}): {
  child: FakeChild;
  spawns: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }>;
  lines: string[];
  stderr: string[];
  debugs: string[];
  exits: Array<{ code: number | null; signal: string | null; spawnError?: string }>;
  transport: ReturnType<typeof createStdioTransport>;
} {
  const child = new FakeChild();
  const spawns: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];
  const lines: string[] = [];
  const stderr: string[] = [];
  const debugs: string[] = [];
  const exits: Array<{ code: number | null; signal: string | null; spawnError?: string }> = [];

  const spawnImpl = ((file: string, args: readonly string[], opts: Record<string, unknown>) => {
    spawns.push({ file, args, options: opts });
    return child as unknown as ReturnType<SpawnLike>;
  }) as SpawnLike;

  const transport = createStdioTransport({
    file: 'node',
    args: ['server.js'],
    onStderr: (t) => stderr.push(t),
    onDebug: (m) => debugs.push(m),
    onExit: (i) => exits.push(i),
    spawnImpl,
    ...options,
  });
  transport.onLine((line) => lines.push(line));
  return { child, spawns, lines, stderr, debugs, exits, transport };
}

describe('createStdioTransport · 启动', () => {
  it('以数组传参、不开 shell、隐藏窗口（不把注入面重新打开）', () => {
    const { spawns } = setup();
    expect(spawns[0]?.file).toBe('node');
    expect(spawns[0]?.args).toEqual(['server.js']);
    expect(spawns[0]?.options['shell']).toBe(false);
    expect(spawns[0]?.options['stdio']).toEqual(['pipe', 'pipe', 'pipe']);
    expect(spawns[0]?.options['windowsHide']).toBe(true);
  });

  it('额外环境变量叠加在 process.env 之上', () => {
    const { spawns } = setup({ env: { FOO: 'bar' } });
    const env = spawns[0]?.options['env'] as Record<string, string>;
    expect(env['FOO']).toBe('bar');
    expect(typeof env['PATH']).toBe('string');
  });

  it('pid / alive 反映子进程状态', () => {
    const { child, transport } = setup();
    expect(transport.pid).toBe(4242);
    expect(transport.alive).toBe(true);
    child.die(0, null);
    expect(transport.alive).toBe(false);
  });
});

describe('createStdioTransport · 按行切分（最容易写出挂死的一段）', () => {
  it('send 补换行写入', () => {
    const { child, transport } = setup();
    transport.send('{"a":1}');
    expect(child.stdin.writes).toEqual(['{"a":1}\n']);
  });

  it('一行跨越两个 chunk：必须先缓冲，不能把半行当垃圾丢掉', () => {
    const { child, lines } = setup();
    child.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0","id":1,"resu', 'utf8'));
    expect(lines).toEqual([]);
    child.stdout.emit('data', Buffer.from('lt":{"ok":true}}\n', 'utf8'));
    expect(lines).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"ok":true}}']);
  });

  it('一个 chunk 里的多行被逐行拆开', () => {
    const { child, lines } = setup();
    child.stdout.emit('data', Buffer.from('line1\nline2\nline3\n', 'utf8'));
    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('CRLF 的行尾 \\r 被剥掉（Windows 子进程常见）', () => {
    const { child, lines } = setup();
    child.stdout.emit('data', Buffer.from('{"id":1}\r\n', 'utf8'));
    expect(lines).toEqual(['{"id":1}']);
  });

  it('空行与纯空白行被忽略（不产生无意义的"非法报文"日志）', () => {
    const { child, lines } = setup();
    child.stdout.emit('data', Buffer.from('\n   \n\t\nreal\n', 'utf8'));
    expect(lines).toEqual(['real']);
  });

  it('多字节字符跨 chunk 被切断时能正确拼回（StringDecoder 生效）', () => {
    const { child, lines } = setup();
    const full = Buffer.from('{"t":"中文"}\n', 'utf8');
    // 「中」占 6、7、8 三个字节，在第 8 字节处切开 → 必定切在多字节字符中间
    child.stdout.emit('data', full.subarray(0, 8));
    child.stdout.emit('data', full.subarray(8));
    expect(lines).toEqual(['{"t":"中文"}']);
    expect(lines[0]?.includes('\uFFFD')).toBe(false);
  });

  it('一个 chunk 给字符串也能处理（便于其他传输实现复用本层）', () => {
    const { child, lines } = setup();
    child.stdout.emit('data', 'hello\n');
    expect(lines).toEqual(['hello']);
  });
});

describe('createStdioTransport · stderr 与容错', () => {
  it('stderr 走日志通道，不混进协议通道', () => {
    const { child, lines, stderr } = setup();
    child.stderr.emit('data', Buffer.from('[server] starting\n', 'utf8'));
    expect(stderr).toEqual(['[server] starting']);
    expect(lines).toEqual([]);
  });

  it('超过单行上限的响应行被丢弃并记日志（不让内存被吃光）', () => {
    const { child, lines, debugs } = setup({ maxLineBytes: 16 });
    child.stdout.emit('data', Buffer.from(`${'x'.repeat(100)}\n`, 'utf8'));
    expect(lines).toEqual([]);
    expect(debugs.join('|')).toContain('超长');
  });

  it('一直不换行的巨量数据也会被丢弃并重置缓冲（不是只丢整行）', () => {
    const { child, lines, debugs } = setup({ maxLineBytes: 32 });
    child.stdout.emit('data', Buffer.from('y'.repeat(200), 'utf8'));
    expect(lines).toEqual([]);
    expect(debugs.join('|')).toContain('超长');
    // 缓冲已重置 → 后续正常行仍能通过（不能因为一次污染就永久失效）
    child.stdout.emit('data', Buffer.from('ok\n', 'utf8'));
    expect(lines).toEqual(['ok']);
  });

  it('子进程退出后仍写 stdin 不会让主进程崩（EPIPE 已被监听）', () => {
    const { child } = setup();
    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
  });

  it('写入抛异常时只记日志，不向上抛', () => {
    const { child, transport } = setup();
    child.stdin.write = () => {
      throw new Error('boom');
    };
    expect(() => transport.send('x')).not.toThrow();
  });

  it('单行上限有确定的默认值', () => {
    expect(DEFAULT_MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('createStdioTransport · 退出上报（不能留下无上界的等待）', () => {
  it('子进程退出 → onExit 只报一次', () => {
    const { child, exits } = setup();
    child.die(1, null);
    child.die(1, null);
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ code: 1, signal: null });
  });

  it('spawn 失败（命令不存在）→ onExit 带 spawnError，且不会重复上报 exit', () => {
    const { child, exits } = setup();
    child.emit('error', new Error('spawn npx ENOENT'));
    expect(exits).toHaveLength(1);
    expect(exits[0]?.spawnError).toContain('ENOENT');
    child.die(null, 'SIGTERM');
    expect(exits).toHaveLength(1);
  });
});

describe('createStdioTransport · dispose（不许留孤儿进程）', () => {
  it('Windows：用 taskkill /T /F 杀整棵树，而不是只 kill 父进程', () => {
    const { child, spawns, transport } = setup({ platform: 'win32' });
    transport.dispose();
    const kill = spawns.find((s) => s.file === 'taskkill');
    expect(kill).toBeDefined();
    expect(kill?.args).toEqual(['/pid', '4242', '/T', '/F']);
    expect(child.kills).toEqual([]);
  });

  it('非 Windows：先 SIGTERM，宽限期后 SIGKILL', () => {
    vi.useFakeTimers();
    try {
      const { child, transport } = setup({ platform: 'linux' });
      transport.dispose();
      expect(child.kills).toEqual(['SIGTERM']);
      vi.advanceTimersByTime(KILL_GRACE_MS);
      expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('幂等：重复 dispose 只杀一次', () => {
    const { child, spawns, transport } = setup({ platform: 'win32' });
    transport.dispose();
    transport.dispose();
    expect(spawns.filter((s) => s.file === 'taskkill')).toHaveLength(1);
    expect(child.kills).toEqual([]);
  });

  it('子进程已退出时不再补刀', () => {
    const { child, spawns, transport } = setup({ platform: 'win32' });
    child.die(0, null);
    transport.dispose();
    expect(spawns.filter((s) => s.file === 'taskkill')).toHaveLength(0);
    expect(child.kills).toEqual([]);
  });

  it('dispose 后不再派发行、send 变成 no-op、onLine 不再注册', () => {
    const { child, transport } = setup();
    const after: string[] = [];
    transport.dispose();
    child.stdout.emit('data', Buffer.from('late\n', 'utf8'));
    transport.send('x');
    transport.onLine(() => after.push('x'));
    expect(child.stdin.writes).toEqual([]);
    expect(after).toEqual([]);
  });

  it('退订函数能单独移除某个处理器', () => {
    const { child, transport } = setup();
    const extra: string[] = [];
    const off = transport.onLine((l) => extra.push(l));
    child.stdout.emit('data', Buffer.from('a\n', 'utf8'));
    off();
    child.stdout.emit('data', Buffer.from('b\n', 'utf8'));
    expect(extra).toEqual(['a']);
  });
});

/**
 * 真子进程集成验证：不依赖网络、不依赖 npx 下载，
 * 用当前 node 起一个最小 JSON-RPC 回显服务端，验证**真实 spawn + 真实 stdio** 通。
 * 这一条是本层唯一无法用假流替代的验证。
 */
describe('createStdioTransport · 真实子进程（真 spawn，无网络依赖）', () => {
  const server = `
    process.stderr.write('boot\\n');
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echo: msg.method } }) + '\\n');
      }
    });
  `;

  it('真实子进程：请求发出 → 收到对应响应；stderr 归入日志', async () => {
    const stderr: string[] = [];
    const transport = createStdioTransport({
      file: process.execPath,
      args: ['-e', server],
      onStderr: (t) => stderr.push(t),
    });

    try {
      const line = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('等待子进程响应超时')), 10_000);
        transport.onLine((l) => {
          clearTimeout(timer);
          resolve(l);
        });
        transport.send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }));
      });

      const msg = JSON.parse(line) as { id: number; result: { echo: string } };
      expect(msg.id).toBe(7);
      expect(msg.result.echo).toBe('ping');
      expect(stderr).toContain('boot');
      expect(transport.alive).toBe(true);
    } finally {
      transport.dispose();
    }

    // dispose 之后不能再派发行
    expect(transport.alive).toBe(false);
  }, 20_000);
});
