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

/**
 * **只有经 `cmd.exe` 那一道才会被解释**的三个字符（T15）：
 * - `%` 变量展开（`%USERPROFILE%` 在命令行被替换成实际值 —— 藏得住内容，也带得进路径）；
 * - `^` 是 cmd 的转义符（能把上面那张表里的字符"洗白"再让 cmd 重新解释一次）；
 * - `!` 在开启延迟展开的 cmd 里同样是展开符。
 *
 * 刻意**不并进上面那张表**： argv 数组直 spawn 时（POSIX 一律如此，Windows 上非批处理包装器也如此）
 * 这三个字符就是普通字面量，一起禁会误伤合法参数（例如 `--format=%Y-%m-%d`）。
 * 判据必须跟着"到底走不走 shell"走 —— 这比"多禁几个字符"看起来更严，实际更准。
 */
const CMD_METACHAR = /[%^!]/;

/**
 * 这条命令会不会经 `cmd.exe` 转一道。**唯一的判据在这里**：
 * `buildArgvCommand` 与 `checkArgvSafety` 都调它。
 * 之前判据长在 `buildArgvCommand` 里面，安全检查看不到它 —— 那正是 T15 能存在的形状：
 * 两个函数各自决定"什么算危险"，久了必分叉（本模块头部说的事，这次轮到我自己踩）。
 */
export function goesThroughCmd(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  // 批处理包装器不能直接 spawn；名字要**整名匹配**，`my-npm-wrapper` 那种不算
  return /\.(cmd|bat)$/i.test(command) || /^(npx|npm|yarn|pnpm)$/i.test(command);
}

export interface ArgvSpec {
  file: string;
  args: string[];
}

export interface ArgvCheck {
  ok: boolean;
  errors: string[];
}

/**
 * 校验 command/args 是否安全（不检查是否为空，那是调用方的业务规则）。
 * `platform` 只影响"要不要额外拒 `% ^ !`"这一条 —— 其余判据不分平台。
 */
export function checkArgvSafety(
  command: unknown,
  args: unknown,
  platform: NodeJS.Platform = process.platform,
): ArgvCheck {
  const errors: string[] = [];
  const viaCmd = typeof command === 'string' && goesThroughCmd(command, platform);
  const bad = (s: string): boolean => SHELL_METACHAR.test(s) || (viaCmd && CMD_METACHAR.test(s));
  // 拒绝理由要说清"为什么这条路才拒"，否则用户遇到的是一个看不懂的禁令
  const why = viaCmd ? '含 shell 元字符（这条命令会经 cmd.exe，%VAR% 与 ^ 会被解释），已拒绝' : '含 shell 元字符，已拒绝（防止命令注入）';

  if (typeof command === 'string' && bad(command)) {
    errors.push(`command ${why}`);
  }
  if (Array.isArray(args)) {
    for (const a of args) {
      if (typeof a === 'string' && bad(a)) {
        errors.push(`args ${why}：${a.slice(0, 40)}`);
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
  if (!goesThroughCmd(command, platform)) return { file: command, args: [...args] };
  return { file: 'cmd.exe', args: ['/c', command, ...args] };
}
