/**
 * 子进程树清理（共用模块）。
 *
 * 为什么必须共用：MCP 服务端与生命周期钩子都是"用户配置的外部进程"，
 * 都可能被 `cmd.exe /c npx …` 这样的三层结构启动（父 → 子 → 孙）。
 * 只 `kill()` 父进程会把真正的 node 进程留成孤儿继续跑（本项目实测过）。
 * 各写一份的后果是两边行为分叉，最后总有一边漏掉 taskkill。
 */

import { spawn } from 'node:child_process';

/** SIGTERM 之后等多久强杀（卡死的子进程不能无限留在系统里） */
export const KILL_GRACE_MS = 2_000;

/**
 * 能被"杀树"的最小接口。
 *
 * 刻意用宽松类型 + 方法语法：`child_process.ChildProcess` 与宿主自己的
 * `StdioChildLike` 都要能传进来（宽的类型比精确的类型更有用，实测过一次
 * `signalCode: NodeJS.Signals` 太窄导致宿主的实现无法赋值）。
 */
export interface KillableChild {
  pid?: number | undefined;
  exitCode?: number | null | undefined;
  signalCode?: string | null | undefined;
  kill(signal?: string): unknown;
}

export interface KillTreeDeps {
  /**
   * 可注入，便于单测与复用宿主自己的 spawn 包装。
   * 用宽松签名（`readonly string[]` + `Record<string, unknown>`）：宿主的 SpawnLike
   * 与真实的 `child_process.spawn` 都要能传进来，类型太精确反而两边都接不上（实测过）。
   */
  spawn?: (file: string, args: readonly string[], options: Record<string, unknown>) => unknown;
  debug?: (message: string) => void;
  platform?: NodeJS.Platform;
}

/**
 * 杀掉整棵进程树。
 *
 * - Windows：`taskkill /pid <pid> /T /F`（`/T` 才会带走孙进程）
 * - 其他平台：先 SIGTERM，宽限期后 SIGKILL
 * - 已经退出的进程直接返回（避免对已死 pid 发信号）
 */
export function killProcessTree(child: KillableChild, deps: KillTreeDeps = {}): void {
  const doSpawn = deps.spawn ?? spawn;
  const platform = deps.platform ?? process.platform;
  const debug = deps.debug ?? ((): void => undefined);

  if (child.exitCode !== null && child.exitCode !== undefined) return;
  if (child.signalCode !== null && child.signalCode !== undefined) return;

  const pid = child.pid;
  if (platform === 'win32' && typeof pid === 'number' && pid > 0) {
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
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // 已退出，忽略
    }
  }, KILL_GRACE_MS);
  (timer as { unref?: () => void }).unref?.();
}
