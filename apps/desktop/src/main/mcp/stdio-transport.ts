/**
 * MCP stdio 传输（W10d）—— `McpTransport` 的**真实子进程**实现。
 *
 * 只在主进程使用：核心的 `McpClient` 不关心传输是子进程还是别的（见 client.ts 的说明），
 * 因此这一层唯一要做对的，是"把子进程的字节流切成干净的行"以及"退干净"。
 *
 * 这里踩过的坑都写成了代码里的注释，因为每一条都会在真实使用中变成"莫名其妙的挂死"：
 * 1. **一行可能跨多个 chunk**：MCP 服务端回一条大响应时，`data` 事件只给半行 JSON。
 *    不缓冲就会 JSON 解析失败，表现为"请求超时"（响应被当成非法行丢弃）。
 * 2. **一个 chunk 可能是多行**：服务端连续回包时会合并。
 * 3. **UTF-8 多字节字符可能被切断**：中文内容被切成半个字符 → 替换字符 → JSON 解析失败。
 *    用 `StringDecoder` 而不是 `chunk.toString()`。
 * 4. **stderr 不是协议数据**：多数 MCP 服务端把日志写 stderr，混进协议通道会污染解析。
 * 5. **spawn 失败（命令不存在）走 `error` 事件而不是抛异常**：不监听 `error`
 *    会变成 unhandled error 直接崩主进程。
 * 6. **子进程已经死掉后写 stdin 会 emit `error`（EPIPE）**：同样必须监听，否则崩主进程。
 * 7. **Windows 上必须杀整棵进程树**：我们用 `cmd.exe /c npx …` 启动，
 *    只 `kill()` cmd.exe 会把真正的 node 进程留成孤儿（实测过）。
 */

import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { McpTransport } from '@jujia/agent-core';

/** 单行上限：故障/恶意的服务端可能一直吐不换行的数据，把主进程内存吃光 */
export const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;

/** 先礼后兵：SIGTERM 之后等这么久还没退就 SIGKILL */
export const KILL_GRACE_MS = 2_000;

/** 子进程的最小结构（便于测试注入假实现，不依赖真实的 ChildProcess 类型） */
export interface StdioChildLike {
  pid?: number | undefined;
  exitCode?: number | null | undefined;
  signalCode?: string | null | undefined;
  stdin: {
    write: (chunk: string) => unknown;
    end: () => unknown;
    on: (event: 'error', cb: (err: Error) => void) => unknown;
  };
  stdout: { on: (event: 'data', cb: (chunk: unknown) => void) => unknown } & {
    on: (event: 'error', cb: (err: Error) => void) => unknown;
  };
  stderr: { on: (event: 'data', cb: (chunk: unknown) => void) => unknown } & {
    on: (event: 'error', cb: (err: Error) => void) => unknown;
  };
  on: (event: 'exit', cb: (code: number | null, signal: string | null) => void) => unknown;
  kill: (signal?: string) => unknown;
}

/** `on('error')` 需要单独的签名重载，这里用一个松散但可注入的类型 */
export type ChildErrorHandler = (err: Error) => void;

export type SpawnLike = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => StdioChildLike & { on: (event: 'error', cb: ChildErrorHandler) => unknown };

export interface StdioExitInfo {
  code: number | null;
  signal: string | null;
  /** spawn 层面就失败（最常见是 ENOENT：命令不存在） */
  spawnError?: string;
}

export interface StdioTransportOptions {
  /** 已做平台适配的可执行文件（见 mcp.ts 的 buildServerCommand） */
  file: string;
  args: readonly string[];
  /** 额外环境变量（会叠加在 process.env 之上） */
  env?: Record<string, string>;
  cwd?: string;
  maxLineBytes?: number;
  onStderr?: (text: string) => void;
  onDebug?: (message: string) => void;
  /** 子进程退出或启动失败时回调 —— 上层据此结束所有挂起请求，绝不留下无上界的 await */
  onExit?: (info: StdioExitInfo) => void;
  /** 测试注入 */
  spawnImpl?: SpawnLike;
  platform?: NodeJS.Platform;
}

export interface StdioTransportHandle extends McpTransport {
  readonly pid: number | undefined;
  /** 是否还在运行 */
  readonly alive: boolean;
}

/**
 * 造一个按行切分的消费者。
 *
 * 单独抽出来是因为 stdout 与 stderr 都要按行处理，而缓冲 + 多字节解码
 * 是最容易写错的一段（见文件头 1–3 条坑）。
 */
function makeLineSplitter(opts: {
  maxBytes: number;
  onLine: (line: string) => void;
  onOversize: (bytes: number) => void;
}): (chunk: unknown) => void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let bufferBytes = 0;

  return (chunk: unknown): void => {
    // 测试注入的假流可能直接给字符串；真实流给的是 Buffer
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
    if (text === '') return;

    buffer += text;
    bufferBytes += Buffer.byteLength(text, 'utf8');

    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const withNewline = buffer.slice(0, idx + 1);
      // Windows 子进程常给 CRLF，行尾的 \r 必须剥掉（否则会进 JSON/日志）
      const raw = buffer.slice(0, idx);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

      buffer = buffer.slice(idx + 1);
      // 用增量减法而不是每轮重算 buffer 字节数：后者在"一个 chunk 里很多行"时是 O(n²)
      bufferBytes -= Buffer.byteLength(withNewline, 'utf8');

      if (line.trim() !== '') {
        if (Buffer.byteLength(line, 'utf8') > opts.maxBytes) {
          opts.onOversize(Buffer.byteLength(line, 'utf8'));
        } else {
          opts.onLine(line);
        }
      }
      idx = buffer.indexOf('\n');
    }

    // 没有换行的残留本身就是"巨行"：主动丢弃，避免内存被慢慢吃光
    if (bufferBytes > opts.maxBytes) {
      opts.onOversize(bufferBytes);
      buffer = '';
      bufferBytes = 0;
    }
  };
}

/**
 * 启动子进程并返回一个 `McpTransport`。
 *
 * 注意：**不在这里做握手**。握手是 `McpClient.connect()` 的事，
 * 传输层只负责搬运字节。
 */
export function createStdioTransport(options: StdioTransportOptions): StdioTransportHandle {
  const doSpawn: SpawnLike = options.spawnImpl ?? (spawn as unknown as SpawnLike);
  const platform = options.platform ?? process.platform;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const debug = (message: string): void => options.onDebug?.(message);

  const handlers = new Set<(line: string) => void>();
  let disposed = false;
  let exitReported = false;

  // stdout 走协议通道，stderr 只当日志 —— 混在一起会污染 JSON 解析
  const consumeStdout = makeLineSplitter({
    maxBytes: maxLineBytes,
    onLine: (line) => {
      if (disposed) return;
      for (const handler of handlers) handler(line);
    },
    onOversize: (bytes) => debug(`丢弃超长响应行（${bytes} 字节 > 上限 ${maxLineBytes}）`),
  });
  const consumeStderr = makeLineSplitter({
    maxBytes: maxLineBytes,
    onLine: (line) => options.onStderr?.(line),
    onOversize: (bytes) => debug(`丢弃超长日志行（${bytes} 字节）`),
  });

  const child = doSpawn(options.file, [...options.args], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    // 绝不用 shell：命令与参数已由 buildServerCommand 以数组形式给出，
    // 交给 shell 解析等于把注入面重新打开
    shell: false,
  });

  /** 退出信息只报一次：spawn 失败也会伴随 exit，重复上报会让上层把一次故障当成两次 */
  const reportExit = (info: StdioExitInfo): void => {
    if (exitReported) return;
    exitReported = true;
    options.onExit?.(info);
  };

  child.on('error', (err: Error) => {
    debug(`子进程错误：${err.message}`);
    reportExit({ code: null, signal: null, spawnError: err.message });
  });
  child.on('exit', (code: number | null, signal: string | null) => {
    debug(`子进程退出：code=${String(code)} signal=${String(signal)}`);
    reportExit({ code, signal });
  });

  child.stdout.on('data', consumeStdout);
  child.stderr.on('data', consumeStderr);
  // 子进程死掉后再写 stdin 会 emit error（EPIPE）。不监听就等于让主进程崩掉。
  child.stdin.on('error', (err) => debug(`写入子进程失败（已忽略）：${err.message}`));
  child.stdout.on('error', (err) => debug(`读取子进程输出失败：${err.message}`));
  child.stderr.on('error', (err) => debug(`读取子进程日志失败：${err.message}`));

  /** 杀整棵进程树 */
  const killTree = (): void => {
    if (child.exitCode !== null && child.exitCode !== undefined) return;
    if (child.signalCode !== null && child.signalCode !== undefined) return;

    const pid = child.pid;
    if (platform === 'win32' && typeof pid === 'number' && pid > 0) {
      // Windows：cmd.exe /c npx … 是父 → 子 → 孙三层，kill() 只终止 cmd.exe。
      // taskkill /T 才能把整棵树带走，否则会留下孤儿 node 进程一直跑。
      try {
        doSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        return;
      } catch (err) {
        debug(`taskkill 失败，回退到直接 kill：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      child.kill('SIGTERM');
    } catch (err) {
      debug(`SIGTERM 失败（可能已退出）：${err instanceof Error ? err.message : String(err)}`);
    }
    // 宽限期后强杀：卡死的子进程不能无限留在系统里
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 已退出，忽略
      }
    }, KILL_GRACE_MS);
    (timer as { unref?: () => void }).unref?.();
  };

  return {
    get pid(): number | undefined {
      return child.pid;
    },
    get alive(): boolean {
      if (disposed) return false;
      if (child.exitCode !== null && child.exitCode !== undefined) return false;
      return !(child.signalCode !== null && child.signalCode !== undefined);
    },
    send(line: string): void {
      if (disposed) return;
      try {
        child.stdin.write(`${line}\n`);
      } catch (err) {
        // 写失败不能让主进程崩：记日志，真正的失败会由"请求超时"或 onExit 体现
        debug(`写入子进程失败（已忽略）：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    onLine(handler): () => void {
      if (disposed) return () => undefined;
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      handlers.clear();
      killTree();
    },
  };
}
