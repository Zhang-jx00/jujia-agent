import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import {
  buildTerminalEnv,
  clampSize,
  decideStart,
  describeExitNotice,
  describeTerminalPermission,
  pickShell,
  splitChunks,
  TERMINAL_LIMITS,
  trimTail,
  type AuditAnswer,
  type PermissionResolver,
  type TerminalSize,
} from '@jujia/agent-core';

/**
 * 内置终端的 PTY 服务（W9b · 主进程侧）。
 *
 * 四件事必须在这里做对：
 * 1. **权限门**：终端能执行任意命令 → 归 `exec` 类，**每次新建会话都要用户确认**。
 *    权限门永远在本机（见 docs/PRODUCT-GOAL.md），本服务只负责"问"和"被拒就不起"。
 * 2. **会话生命周期（T23）**：会话属于**工作区**，不属于某个页面实例。
 *    页签切走时渲染层被卸载，会话在这里继续跑；回到终端页时先 `status()` 再接回。
 *    配套的两条约束不能省：会话数有上界（`decideStart`）、切走期间的输出只留有界的尾部。
 * 3. **输出分块**：一次 `cat` 大文件可能吐几百 KB，单次 IPC 发送会卡死渲染层。
 * 4. **清理**：窗口关闭 / 应用退出时必须杀掉所有 PTY，否则会留下僵尸子进程。
 *
 * 原生依赖（node-pty）**只在这一处出现** —— 纯逻辑在 `@jujia/agent-core/terminal`，
 * 那里有单测覆盖，不需要加载 .node。
 */

export type TerminalEvent =
  | { type: 'data'; sessionId: string; chunk: string; seq: number }
  | { type: 'exit'; sessionId: string; exitCode: number };

export type TerminalEmitter = (event: TerminalEvent) => void;

/**
 * 记账出口（T41 · 2026-10-15）：内置终端进执行审计的**那一类**记录。
 *
 * 为什么由服务自己交、而不是让接线层去问一遍：判定只在这里发生过一次（`this.permission(...)`），
 * 第二处推导就是"两处各说各话"的老病（与 `runTool` 的 `onDecision` 同一条理由）。
 * 这里也**只交事实**：`outcome` 恒为 ask 与 `decidedBy:'person'` 由接线层标，
 * 因为那是"这一类账"的定义，不是这一次运行的观测值 —— 定义写在一处，观测值写在一处。
 *
 * 只有**真的问过**才走这个出口：接回已有会话（adopt）与超出上限（refuse）一个新进程都没起、
 * 一次也没问，凭空记一条等于伪造判定（与"参数校验没过不进审计"同一条口径）。
 */
export interface TerminalGateFacts {
  /** 人答了什么（deny / timeout 也要有 —— 记了问过就必须记答复） */
  answer: AuditAnswer;
  /** 这件事最后做没做成：被拒、超时、spawn 失败都是 false */
  executed: boolean;
  durationMs: number;
  /** 当面问过（恒 true；留成一格是为了让 `makeRecord` 的判据有机会拦谎） */
  asked: boolean;
  args: Record<string, unknown>;
}

export type TerminalGateRecorder = (facts: TerminalGateFacts) => void;

export interface StartParams {
  /** 工作区根目录（也是终端的初始 cwd） */
  workspaceRoot: string;
  cols?: number;
  rows?: number;
}

export type StartResult =
  | { ok: true; sessionId: string; adopted: boolean }
  | { ok: false; error: string };

/** 给重新挂载的面板用：现在有没有可接回的会话、切走期间吐了什么、上一个会话是怎么结束的 */
export interface TerminalStatus {
  session: { sessionId: string; tail: string; seq: number } | null;
  exited: { exitCode: number; notice: string } | null;
  liveCount: number;
  maxSessions: number;
}

interface Session {
  id: string;
  proc: pty.IPty;
  workspaceRoot: string;
  /** 输出尾部（有界）：切走期间的输出靠它补回视图 */
  tail: string;
  /** 已发出的批次序号：渲染层用它过滤掉 tail 里已经包含的事件（重复显示比丢几行更好治，但两个都不想要） */
  seq: number;
}

export class TerminalService {
  private readonly sessions = new Map<string, Session>();

  /**
   * 每个工作区**最近一次**的退出记录。
   * 为什么需要：会话结束事件是推给渲染层的，而面板可能在别的页签上根本没订阅 ——
   * 没有这份记录时，回来看到的是"未启动"，用户会以为是切页签把会话弄丢了。
   * 与 sessions 同样有界（超出时按插入顺序丢最老的工作区）。
   */
  private readonly exits = new Map<string, number>();

  constructor(
    private readonly emit: TerminalEmitter,
    private readonly permission: PermissionResolver,
    /** 记账出口（T41）；不传 = 不记账（单测与"审计还没装配起来"的启动窗口） */
    private readonly recordGate: TerminalGateRecorder = () => undefined,
  ) {}

  /** 当前活跃会话数（供 smoke / 诊断使用） */
  get activeCount(): number {
    return this.sessions.size;
  }

  private findLive(workspaceRoot: string): Session | null {
    for (const s of this.sessions.values()) {
      if (s.workspaceRoot === workspaceRoot) return s;
    }
    return null;
  }

  /**
   * 新建终端会话，或接回本工作区已有的那个。
   *
   * 顺序是**接回 → 上限 → 审批 → 启动**：
   * - 接回排在最前：本工作区已有会话时绝不再起进程（起了就没人能关掉前一个，直到应用退出）；
   * - 上限排在审批前：先弹审批再说"开不了"，等于骗用户点一次确认；
   * - 只有真的 `spawn` 才过权限门 —— "每次新建会话都要确认"这条语义一个字没变。
   */
  async start(params: StartParams): Promise<StartResult> {
    const decision = decideStart({
      liveSessionId: this.findLive(params.workspaceRoot)?.id ?? null,
      liveCount: this.sessions.size,
      maxSessions: TERMINAL_LIMITS.maxSessions,
    });

    if (decision.kind === 'adopt') {
      return { ok: true, sessionId: decision.sessionId, adopted: true };
    }
    if (decision.kind === 'refuse') {
      return { ok: false, error: decision.reason };
    }

    const shell = pickShell(process.platform, process.env);
    const size = clampSize(params);

    // ---- 权限门：exec 类，必须用户确认（仅新起进程时）----
    // T41：这一次当面问的**事实**要进账（问过什么、人答了什么、做没做成）
    const gateStarted = Date.now();
    const gateArgs = { cwd: params.workspaceRoot, cols: size.cols, rows: size.rows };
    const answer = await this.permission({
      id: randomUUID(),
      toolName: 'terminal',
      kind: 'exec',
      summary: describeTerminalPermission(shell, params.workspaceRoot),
      args: gateArgs,
      paths: [params.workspaceRoot],
      // 启动终端 = 执行类，永远是硬 ask：给 false，弹窗就不会显示一个只兑现一次的「总是允许」
      bypassable: false,
    });

    // normalizeAnswer 在 executor 内部；这里只认字符串决策（权限桥返回的也是字符串）
    const verdict = typeof answer === 'string' ? answer : answer.decision;
    if (verdict === 'deny' || verdict === 'timeout') {
      this.recordGate({
        answer: verdict,
        asked: true,
        // 被拒与超时都是"没起进程"：这一格不许留 true（"批过"与"做过"是两格）
        executed: false,
        durationMs: Date.now() - gateStarted,
        args: gateArgs,
      });
      return { ok: false, error: verdict === 'deny' ? '你拒绝了启动终端' : '审批超时，未启动终端' };
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
      // 人批了却起不来：答复照常记（问过、答了），但 executed=false ——
      // 少了这一格，"没做成"与"做成了"在账上就长一样了
      this.recordGate({
        answer: verdict,
        asked: true,
        executed: false,
        durationMs: Date.now() - gateStarted,
        args: gateArgs,
      });
      return { ok: false, error: `终端启动失败：${err instanceof Error ? err.message : String(err)}` };
    }
    this.recordGate({
      answer: verdict,
      asked: true,
      executed: true,
      durationMs: Date.now() - gateStarted,
      args: gateArgs,
    });

    const session: Session = {
      id: randomUUID(),
      proc,
      workspaceRoot: params.workspaceRoot,
      tail: '',
      seq: 0,
    };
    this.sessions.set(session.id, session);
    // 新会话起来了，本工作区"上一个会话已退出"的提示就该让位
    this.exits.delete(params.workspaceRoot);

    proc.onData((data: string) => {
      // 先记账再推送：tail 与 seq 是"切走期间的输出"的唯一去处，与有没有人听无关
      session.seq += 1;
      session.tail = trimTail(session.tail, data);
      // 分块推送，避免一次性巨量输出打爆 IPC
      for (const chunk of splitChunks(data)) {
        this.emit({ type: 'data', sessionId: session.id, chunk, seq: session.seq });
      }
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(session.id);
      this.rememberExit(session.workspaceRoot, exitCode);
      this.emit({ type: 'exit', sessionId: session.id, exitCode });
    });

    return { ok: true, sessionId: session.id, adopted: false };
  }

  /** 本工作区的会话现状（面板重新挂载时先问这个，再决定接回还是启动） */
  status(workspaceRoot: string): TerminalStatus {
    const live = this.findLive(workspaceRoot);
    if (live) {
      return {
        session: { sessionId: live.id, tail: live.tail, seq: live.seq },
        exited: null,
        liveCount: this.sessions.size,
        maxSessions: TERMINAL_LIMITS.maxSessions,
      };
    }
    const exitCode = this.exits.get(workspaceRoot);
    return {
      session: null,
      exited:
        exitCode === undefined
          ? null
          : { exitCode, notice: describeExitNotice(exitCode) },
      liveCount: this.sessions.size,
      maxSessions: TERMINAL_LIMITS.maxSessions,
    };
  }

  private rememberExit(workspaceRoot: string, exitCode: number): void {
    // 只留最近 maxSessions 个工作区的退出记录：再多的话这个 Map 也会无限涨
    while (this.exits.size >= TERMINAL_LIMITS.maxSessions) {
      const oldest = this.exits.keys().next();
      if (oldest.done) break;
      this.exits.delete(oldest.value);
    }
    this.exits.set(workspaceRoot, exitCode);
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

  /** 结束单个会话（**用户手工关闭**：这是 T23 之后会话唯一的结束入口之一，另一个是进程自己退出） */
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
