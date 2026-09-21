import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import {
  buildTerminalEnv,
  clampSize,
  describeTerminalPermission,
  pickShell,
  splitChunks,
  type PermissionResolver,
  type TerminalSize,
} from '@jujia/agent-core';

/**
 * 内置终端的 PTY 服务（W9b · 主进程侧）。
 *
 * 三件事必须在这里做对：
 * 1. **权限门**：终端能执行任意命令 → 归 `exec` 类，**每次新建会话都要用户确认**。
 *    权限门永远在本机（见 docs/PRODUCT-GOAL.md），本服务只负责"问"和"被拒就不起"。
 * 2. **输出分块**：一次 `cat` 大文件可能吐几百 KB，单次 IPC 发送会卡死渲染层。
 * 3. **清理**：窗口关闭 / 应用退出时必须杀掉所有 PTY，否则会留下僵尸子进程。
 *
 * 原生依赖（node-pty）**只在这一处出现** —— 纯逻辑在 `@jujia/agent-core/terminal`，
 * 那里有单测覆盖，不需要加载 .node。
 */

export type TerminalEvent =
  | { type: 'data'; sessionId: string; chunk: string }
  | { type: 'exit'; sessionId: string; exitCode: number };

export type TerminalEmitter = (event: TerminalEvent) => void;

export interface StartParams {
  /** 工作区根目录（也是终端的初始 cwd） */
  workspaceRoot: string;
  cols?: number;
  rows?: number;
}

export type StartResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

interface Session {
  id: string;
  proc: pty.IPty;
  workspaceRoot: string;
}

export class TerminalService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly emit: TerminalEmitter,
    private readonly permission: PermissionResolver,
  ) {}

  /** 当前活跃会话数（供 smoke / 诊断使用） */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * 新建终端会话。
   * **先过权限门**：被拒 / 超时一律不启动，并如实返回原因（不静默降级成"假装成功"）。
   */
  async start(params: StartParams): Promise<StartResult> {
    const shell = pickShell(process.platform, process.env);
    const size = clampSize(params);

    // ---- 权限门：exec 类，必须用户确认 ----
    const answer = await this.permission({
      id: randomUUID(),
      toolName: 'terminal',
      kind: 'exec',
      summary: describeTerminalPermission(shell, params.workspaceRoot),
      args: { cwd: params.workspaceRoot, cols: size.cols, rows: size.rows },
      paths: [params.workspaceRoot],
    });

    // normalizeAnswer 在 executor 内部；这里只认字符串决策（权限桥返回的也是字符串）
    const decision = typeof answer === 'string' ? answer : answer.decision;
    if (decision === 'deny' || decision === 'timeout') {
      return { ok: false, error: decision === 'deny' ? '你拒绝了启动终端' : '审批超时，未启动终端' };
    }

    // ---- 启动 PTY ----
    let proc: pty.IPty;
    try {
      proc = pty.spawn(shell.file, shell.args, {
        // 这两个值是「有颜色 / 真彩色」的关键（见 agent-core/terminal 注释）
        name: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        cwd: params.workspaceRoot,
        env: buildTerminalEnv(process.env, { workspaceRoot: params.workspaceRoot }),
      });
    } catch (err) {
      return { ok: false, error: `终端启动失败：${err instanceof Error ? err.message : String(err)}` };
    }

    const session: Session = { id: randomUUID(), proc, workspaceRoot: params.workspaceRoot };
    this.sessions.set(session.id, session);

    proc.onData((data: string) => {
      // 分块推送，避免一次性巨量输出打爆 IPC
      for (const chunk of splitChunks(data)) {
        this.emit({ type: 'data', sessionId: session.id, chunk });
      }
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(session.id);
      this.emit({ type: 'exit', sessionId: session.id, exitCode });
    });

    return { ok: true, sessionId: session.id };
  }

  /** 把用户在终端里的输入写进 PTY */
  write(sessionId: string, data: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.proc.write(data);
    return true;
  }

  /** 调整尺寸（高频事件，尺寸已在 clampSize 里收敛到合法范围） */
  resize(sessionId: string, size: { cols?: unknown; rows?: unknown }): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const clamped: TerminalSize = clampSize(size);
    try {
      s.proc.resize(clamped.cols, clamped.rows);
      return true;
    } catch {
      // resize 期间进程可能正好退出：属于正常竞态，不当错误上报
      return false;
    }
  }

  /** 结束单个会话 */
  kill(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    try {
      s.proc.kill();
    } catch {
      // 已退出：忽略
    }
    this.sessions.delete(sessionId);
    return true;
  }

  /** 结束所有会话（窗口关闭 / 应用退出时必须调用，否则留下僵尸子进程） */
  disposeAll(): number {
    const count = this.sessions.size;
    for (const id of [...this.sessions.keys()]) this.kill(id);
    return count;
  }
}
