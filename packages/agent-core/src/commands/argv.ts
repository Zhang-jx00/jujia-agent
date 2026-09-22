/**
 * argv 命令适配与安全检查（共用模块）。
 *
 * 为什么单独成文件：MCP 服务端与生命周期钩子都要"启动一个用户配置的外部进程"，
 * 二者必须遵守**同一套**规则 ——
 * 1. **以 argv 数组传参，绝不拼 shell 字符串**；
 * 2. 命令与参数里出现 shell 元字符一律拒绝（否则 `; rm -rf` 之类会被当作命令的一部分）；
 * 3. 只有 Windows 上的批处理包装器（.cmd/.bat 与 npx/npm/yarn/pnpm）才经 cmd.exe 转一道。
 *
 * 各写一份的后果是两份安全规则会逐渐分叉，最后总有一边漏掉一条。
 */

/** shell 元字符与换行：一旦出现在 command/args 里就拒绝（我们不拼 shell 字符串） */
const SHELL_METACHAR = /[|&;<>`$]|\r|\n/;

export interface ArgvSpec {
  file: string;
  args: string[];
}

export interface ArgvCheck {
  ok: boolean;
  errors: string[];
}

/** 校验 command/args 是否安全（不检查是否为空，那是调用方的业务规则） */
export function checkArgvSafety(command: unknown, args: unknown): ArgvCheck {
  const errors: string[] = [];

  if (typeof command === 'string' && SHELL_METACHAR.test(command)) {
    errors.push('command 含 shell 元字符，已拒绝（防止命令注入）');
  }
  if (Array.isArray(args)) {
    for (const a of args) {
      if (typeof a === 'string' && SHELL_METACHAR.test(a)) {
        errors.push(`args 含 shell 元字符，已拒绝：${a.slice(0, 40)}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 把「命令 + 参数数组」翻译成可 spawn 的形式。
 * **不做任何字符串拼接** —— 返回的 args 仍是数组，由 spawn 以 argv 方式传给进程。
 */
export function buildArgvCommand(
  command: string,
  args: ReadonlyArray<string>,
  platform: NodeJS.Platform = process.platform,
): ArgvSpec {
  if (platform !== 'win32') return { file: command, args: [...args] };

  // Windows：批处理包装器不能直接 spawn，需要 cmd /c 转一道
  const needsCmd = /\.(cmd|bat)$/i.test(command) || /^(npx|npm|yarn|pnpm)$/i.test(command);
  if (!needsCmd) return { file: command, args: [...args] };
  return { file: 'cmd.exe', args: ['/c', command, ...args] };
}
